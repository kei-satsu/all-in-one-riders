import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAppTheme, useThemeStyles } from '../lib/theme-provider';

type IntakeMode = 'without-barcode' | 'with-barcode';
type Screen = 'choose' | 'camera' | 'review' | 'queue';
type Quality = 'SD' | 'HD';

type IntakeImage = {
  id: string;
  uri: string;
  width: number;
  height: number;
  barcode: string | null;
  quality: Quality;
};

type QueueItem = {
  id: string;
  fileBase64: string;
  fileName: string;
  barcode: string | null;
  branch: string;
  rider_id: string;
  received_date: string;
  uploader_note: string | null;
  transit: { transit_to: string; transit_date: string; transit_from: string }[] | null;
  imageUrl?: string;
  recordSaved?: boolean;
};

type QueueStatus = 'idle' | 'uploading' | 'success' | 'error';

const QUEUE_INDEX_KEY = 'intake-upload-queue:index';
const QUEUE_ITEM_PREFIX = 'intake-upload-queue:item:';
const API_BASE_URL = process.env.EXPO_PUBLIC_INTAKE_API_URL?.trim().replace(/\/+$/, '');

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day);
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'မမျှော်လင့်ထားသော အမှားတစ်ခု ဖြစ်ပေါ်ခဲ့သည်။';
}

function intakeApiUrl(path: string) {
  if (!API_BASE_URL) {
    throw new Error('EXPO_PUBLIC_INTAKE_API_URL ကို app environment ထဲတွင် သတ်မှတ်ပါ။');
  }
  return `${API_BASE_URL}${path}`;
}

async function intakeFetch(path: string, init: RequestInit = {}, useExpoFetch = false) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  const request = { ...init, headers };
  if (useExpoFetch) return expoFetch(intakeApiUrl(path), request);
  return fetch(intakeApiUrl(path), request);
}

async function findExistingBarcode(barcode: string) {
  const query = encodeURIComponent(JSON.stringify({
    select: 'id',
    filters: [{ kind: 'eq', column: 'barcode', value: barcode }],
    limit: 1,
  }));
  const response = await intakeFetch(`/api/table/orders?query=${query}`);
  const result = await readJsonResponse(response);
  const data = result.data;
  return Array.isArray(data) ? data[0] ?? null : null;
}

async function insertIntakeOrder(order: Record<string, unknown>) {
  const response = await intakeFetch('/api/table/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [order], select: 'id' }),
  });
  return readJsonResponse(response);
}

async function getQueueIds(): Promise<string[]> {
  const rawIds = await AsyncStorage.getItem(QUEUE_INDEX_KEY);
  if (!rawIds) return [];
  try {
    const ids: unknown = JSON.parse(rawIds);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function getStoredQueue(): Promise<QueueItem[]> {
  const ids = await getQueueIds();
  if (ids.length === 0) return [];
  const storedItems = await AsyncStorage.multiGet(ids.map((id) => `${QUEUE_ITEM_PREFIX}${id}`));
  return storedItems.flatMap(([, value]) => {
    if (!value) return [];
    try {
      return [JSON.parse(value) as QueueItem];
    } catch {
      return [];
    }
  });
}

async function saveQueueItem(item: QueueItem) {
  const ids = await getQueueIds();
  await AsyncStorage.setItem(`${QUEUE_ITEM_PREFIX}${item.id}`, JSON.stringify(item));
  if (!ids.includes(item.id)) {
    await AsyncStorage.setItem(QUEUE_INDEX_KEY, JSON.stringify([...ids, item.id]));
  }
}

async function deleteStoredQueueItem(id: string) {
  const ids = await getQueueIds();
  await AsyncStorage.removeItem(`${QUEUE_ITEM_PREFIX}${id}`);
  await AsyncStorage.setItem(QUEUE_INDEX_KEY, JSON.stringify(ids.filter((itemId) => itemId !== id)));
}

function decodeBase64(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0));
  let buffer = 0;
  let bitCount = 0;
  let offset = 0;

  for (const character of value) {
    if (character === '=') break;
    const digit = alphabet.indexOf(character);
    if (digit < 0) continue;
    buffer = (buffer << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[offset] = (buffer >> bitCount) & 0xff;
      offset += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  return bytes.subarray(0, offset);
}

async function readJsonResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = typeof payload === 'object' && payload !== null ? payload : {};
    const message = 'error' in body ? String(body.error) : `Server တုံ့ပြန်မှု အမှား (${response.status})`;
    const error = new Error(message) as Error & { code?: string };
    if ('code' in body && typeof body.code === 'string') error.code = body.code;
    throw error;
  }
  return payload as Record<string, unknown>;
}

async function sendToTelegram(data: {
  imageUrl: string;
  note: string | null;
  barcode: string | null;
  branch: string;
}) {
  const response = await intakeFetch('/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await readJsonResponse(response);
  if (result.ok !== true) throw new Error(String(result.error || 'Telegram သို့ ပို့၍မရပါ။'));
}

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

const colors = {
  background: '#f8fafc',
  surface: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
  orange: '#f97316',
  orangeSoft: '#fff7ed',
  green: '#16a34a',
  red: '#dc2626',
  camera: '#050505',
};

const baseStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: 520, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  headerTitle: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  headerSpacer: { width: 42, height: 42 },
  hero: { marginTop: 30, marginBottom: 26 },
  heroMark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: '#fed7aa', marginBottom: 14 },
  eyebrow: { color: '#c2410c', fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginBottom: 6 },
  title: { color: colors.text, fontSize: 25, lineHeight: 50, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 7 },
  methodCard: { minHeight: 84, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 10 },
  methodCardPrimary: { borderColor: '#fdba74', backgroundColor: colors.orangeSoft },
  methodIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#f1f5f9' },
  methodIconPrimary: { backgroundColor: '#ffedd5' },
  methodCopy: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  methodTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  methodDescription: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  queueLink: { minHeight: 70, flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  queueLinkIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.orangeSoft },
  queueLinkCopy: { flex: 1, marginLeft: 11 },
  queueLinkTitle: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  queueLinkSubtitle: { color: colors.muted, fontSize: 10, marginTop: 4 },
  queueCount: { color: '#c2410c', fontSize: 12, fontWeight: '900', marginHorizontal: 9 },
  cameraScreen: { flex: 1, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.camera },
  cameraTopBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cameraHeaderButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#292929', backgroundColor: '#151515' },
  cameraModePill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: '#49301f', backgroundColor: '#17120e' },
  cameraModeText: { color: '#ffad70', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  cameraInstruction: { color: '#a1a1aa', fontSize: 10, textAlign: 'center', marginTop: 5 },
  cameraFrame: { flex: 1, minHeight: 240, position: 'relative', overflow: 'hidden', borderRadius: 24, borderWidth: 1, borderColor: '#342619', backgroundColor: '#000000' },
  permissionPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  permissionTitle: { color: '#ffffff', textAlign: 'center', fontSize: 17, fontWeight: '800' },
  permissionDescription: { color: '#a1a1aa', textAlign: 'center', fontSize: 12, lineHeight: 19, marginTop: 9, marginBottom: 18 },
  scanOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  scanHint: { position: 'absolute', top: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.68)' },
  scanHintText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  scanFrame: { width: '82%', height: 165, borderWidth: 2, borderColor: '#ffad70', borderRadius: 18 },
  scannedBadge: { position: 'absolute', top: 14, left: 13, right: 13, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(0,0,0,0.75)' },
  scannedTextWrap: { flex: 1, minWidth: 0 },
  scannedLabel: { color: '#a1a1aa', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  scannedValue: { color: '#ffffff', fontSize: 12, fontWeight: '700', marginTop: 3 },
  thumbnailDock: { position: 'absolute', right: 10, bottom: 10, left: 10, padding: 9, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(8,8,8,0.82)' },
  thumbnailHeader: { minHeight: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thumbnailHeaderText: { color: '#d4d4d8', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  thumbnailRow: { gap: 7, paddingTop: 7 },
  thumbnail: { width: 48, height: 48, overflow: 'hidden', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  thumbnailImage: { width: '100%', height: '100%' },
  thumbnailBarcode: { position: 'absolute', right: 0, bottom: 0, left: 0, paddingHorizontal: 2, backgroundColor: 'rgba(249,115,22,0.9)' },
  thumbnailBarcodeText: { color: '#111111', fontSize: 6, textAlign: 'center', fontWeight: '900' },
  cameraControls: { height: 82, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  cameraControlButton: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: '#302d2a', backgroundColor: '#171717' },
  cameraControlLabel: { color: '#a1a1aa', fontSize: 8, fontWeight: '900', marginTop: 3 },
  shutterOuter: { width: 70, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 35, borderWidth: 3, borderColor: '#f4eee7' },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.orange },
  scanShutter: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 31, backgroundColor: '#fbbf24' },
  cameraFooter: { minHeight: 22, color: '#a1a1aa', fontSize: 9, textAlign: 'center', paddingHorizontal: 8 },
  reviewPage: { flex: 1, backgroundColor: colors.background },
  reviewContent: { flexGrow: 1, gap: 9, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 14 },
  reviewToolbar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  reviewTitleWrap: { flex: 1 },
  reviewEyebrow: { color: '#c2410c', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 3 },
  counter: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  previewFrame: { flex: 1, minHeight: 150, position: 'relative', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#080808' },
  previewImage: { width: '100%', height: '100%' },
  previewBarcode: { position: 'absolute', top: 10, left: 10, maxWidth: '80%', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.76)' },
  previewBarcodeText: { color: '#ffad70', fontSize: 10, fontWeight: '800' },
  previewNav: { position: 'absolute', top: '45%', width: 36, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.65)' },
  previewNavLeft: { left: 9 },
  previewNavRight: { right: 9 },
  form: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  fieldLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginTop: 6, marginBottom: 5 },
  qualityControl: { flexDirection: 'row', padding: 3, borderRadius: 15, backgroundColor: '#f1f5f9' },
  qualityOption: { minWidth: 37, alignItems: 'center', paddingVertical: 6, borderRadius: 12 },
  qualitySelected: { backgroundColor: colors.orange },
  qualityText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  qualityTextSelected: { color: '#17100a' },
  input: { minHeight: 42, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 12 },
  row: { flexDirection: 'row', gap: 10 },
  column: { flex: 1, minWidth: 0 },
  transitToggle: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#94a3b8' },
  checkboxSelected: { borderColor: colors.orange, backgroundColor: colors.orange },
  transitLabel: { flexShrink: 1, color: '#c2410c', fontSize: 10, fontWeight: '700' },
  primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.orange },
  primaryButtonText: { color: '#17100a', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  disabled: { opacity: 0.45 },
  queuePage: { flex: 1, backgroundColor: colors.background },
  queueContent: { flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: 560, gap: 11, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 },
  queueSummary: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#94a3b8' },
  statusUploading: { backgroundColor: '#f59e0b' },
  statusSuccess: { backgroundColor: colors.green },
  statusError: { backgroundColor: colors.red },
  summaryCopy: { flex: 1 },
  summaryText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  summaryHint: { color: colors.muted, fontSize: 10, marginTop: 4 },
  errorBanner: { padding: 11, borderRadius: 12, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  errorText: { color: colors.red, fontSize: 11, lineHeight: 17 },
  emptyQueue: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 22, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 12 },
  emptyHint: { color: colors.muted, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 5 },
  queueCard: { minHeight: 94, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  queueImage: { width: 66, height: 66, borderRadius: 11, backgroundColor: '#111111' },
  queueItemCopy: { flex: 1, minWidth: 0 },
  queueItemTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  queueItemMeta: { color: '#c2410c', fontSize: 9, fontWeight: '700', marginTop: 4 },
  queueItemNote: { color: colors.muted, fontSize: 9, marginTop: 4 },
  queueItemError: { color: colors.red, fontSize: 9, lineHeight: 13, marginTop: 4 },
  queueActions: { alignItems: 'center', gap: 5 },
  retryButton: { minWidth: 48, minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, borderRadius: 9, backgroundColor: colors.orangeSoft },
  retryText: { color: '#c2410c', fontSize: 8, fontWeight: '900' },
  deleteButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#fef2f2' },
  secondaryButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  secondaryButtonText: { color: colors.text, fontSize: 10, fontWeight: '800' },
});

export default function IntakeScreen() {
  const { isDark } = useAppTheme();
  const palette = isDark
    ? { ...colors, text: '#f1f5f9', muted: '#a8b3c5', orange: '#fb923c', green: '#4ade80', red: '#f87171' }
    : colors;
  const styles = useThemeStyles(baseStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const scanLocked = useRef(false);
  const lastRejectedBarcode = useRef('');
  const queueRunInProgress = useRef(false);
  const queueItemErrorsRef = useRef<Record<string, string>>({});

  const [screen, setScreen] = useState<Screen>('choose');
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('without-barcode');
  const [barcodeStep, setBarcodeStep] = useState<'scanning' | 'capturing'>('scanning');
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [cameraReady, setCameraReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<IntakeImage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [branch, setBranch] = useState('');
  const [riderId, setRiderId] = useState<string | null>(null);
  const [branchError, setBranchError] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayKey);
  const [note, setNote] = useState('');
  const [transitToYgn, setTransitToYgn] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>('idle');
  const [queueError, setQueueError] = useState('');
  const [queueItemErrors, setQueueItemErrors] = useState<Record<string, string>>({});
  const selectedImage = images[selectedIndex];

  const refreshQueue = useCallback(async () => {
    const items = await getStoredQueue();
    setQueue(items);
    return items;
  }, []);

  const processIntakeItem = useCallback(async (item: QueueItem) => {
    if (item.recordSaved && item.imageUrl) {
      await sendToTelegram({
        imageUrl: item.imageUrl,
        note: item.uploader_note,
        barcode: item.barcode,
        branch: item.branch,
      });
      return;
    }

    if (item.barcode) {
      const lookupQuery = encodeURIComponent(JSON.stringify({
        select: 'image_url',
        filters: [{ kind: 'eq', column: 'barcode', value: item.barcode }],
        limit: 1,
      }));
      const lookupResponse = await intakeFetch(`/api/table/orders?query=${lookupQuery}`);
      const lookupResult = await readJsonResponse(lookupResponse);
      const existingOrder = Array.isArray(lookupResult.data) ? lookupResult.data[0] : null;

      if (existingOrder) {
        const existingImageUrl = existingOrder.image_url;
        if (typeof existingImageUrl !== 'string' || !existingImageUrl.startsWith('http')) {
          throw new Error('ဒီ barcode ရှိပြီးသားဖြစ်သော်လည်း ပုံ URL မရှိပါ။ Queue ထဲတွင် ဆက်လက်ထားပါသည်။');
        }
        await sendToTelegram({
          imageUrl: existingImageUrl,
          note: item.uploader_note,
          barcode: item.barcode,
          branch: item.branch,
        });
        return;
      }
    }

    if (!item.rider_id) {
      throw new Error('Queue item တွင် Rider ID မရှိပါ။ ဓာတ်ပုံကို ပြန်ရွေးပြီး upload လုပ်ပါ။');
    }

    const imageUrl = item.imageUrl ?? await (async () => {
      const bytes = decodeBase64(item.fileBase64);
      let uploadResponse: Response;
      if (Platform.OS === 'web') {
        const imageBuffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(imageBuffer).set(bytes);
        const formData = new FormData();
        formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), item.fileName);
        uploadResponse = await intakeFetch('/api/upload-r2', {
          method: 'POST',
          body: formData,
        });
      } else {
        const { File, Paths } = await import('expo-file-system');
        const uploadFile = new File(Paths.cache, item.fileName);
        try {
          await uploadFile.write(bytes);
          const formData = new FormData();
          formData.append('file', uploadFile, item.fileName);
          uploadResponse = await intakeFetch('/api/upload-r2', {
            method: 'POST',
            body: formData,
          }, true);
        } finally {
          if (uploadFile.exists) uploadFile.delete();
        }
      }
      const uploadResult = await readJsonResponse(uploadResponse);
      return uploadResult.url;
    })();
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      throw new Error('R2 upload မှ မှန်ကန်သော image URL မရရှိပါ။');
    }

    const currentStatus = 'On Way';
    const timestamp = new Date().toISOString();
    const initialHistory = [{
      status: currentStatus,
      note: item.uploader_note || 'Intake recorded - On Way',
      branch: item.branch,
      date: item.received_date,
      created_at: timestamp,
    }];

    try {
      await insertIntakeOrder({
        image_url: imageUrl,
        branch: item.branch,
        status: currentStatus,
        pickup_rider_id: item.rider_id,
        deliver_rider_id: item.rider_id,
        received_date: item.received_date,
        deliver_date: item.received_date,
        uploader_note: item.uploader_note,
        barcode: item.barcode,
        transit: item.transit,
        history: initialHistory,
      });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === '23505')) throw error;
    }

    await saveQueueItem({ ...item, imageUrl, recordSaved: true });

    await sendToTelegram({
      imageUrl,
      note: item.uploader_note,
      barcode: item.barcode,
      branch: item.branch,
    });
  }, []);

  const runQueue = useCallback(async (itemId?: string) => {
    if (queueRunInProgress.current) return;
    queueRunInProgress.current = true;
    setQueueStatus('uploading');
    setQueueError('');

    try {
      const items = await getStoredQueue();
      const selectedItems = itemId ? items.filter((item) => item.id === itemId) : items;
      for (const item of selectedItems) {
        delete queueItemErrorsRef.current[item.id];
        setQueueItemErrors((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        try {
          await processIntakeItem(item);
          await deleteStoredQueueItem(item.id);
        } catch (error) {
          const message = errorMessage(error);
          queueItemErrorsRef.current[item.id] = message;
          setQueueItemErrors((current) => ({ ...current, [item.id]: message }));
        }
      }
      const remaining = await refreshQueue();
      const failedCount = remaining.filter((item) => Boolean(queueItemErrorsRef.current[item.id])).length;
      if (failedCount > 0) {
        setQueueError(`${failedCount} ပုံ တင်မအောင်မြင်ပါ။ တစ်ပုံချင်း ပြန်တင်နိုင်ပါသည်။`);
        setQueueStatus('error');
      } else if (remaining.length === 0) {
        setQueueStatus('success');
      } else {
        setQueueStatus('idle');
      }
    } catch (error) {
      setQueueError(errorMessage(error));
      setQueueStatus('error');
      await refreshQueue();
    } finally {
      queueRunInProgress.current = false;
    }
  }, [processIntakeItem, refreshQueue]);

  useEffect(() => {
    let mounted = true;
    void getStoredQueue()
      .then((items) => {
        if (!mounted) return;
        setQueue(items);
        if (items.length > 0) setQueueStatus('error');
      })
      .catch((error: unknown) => {
        if (mounted) setQueueError(errorMessage(error));
      });

    void (async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.user.email) {
          router.replace('/login');
          return;
        }
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('rider_id')
          .eq('email', session.user.email)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile?.rider_id) {
          if (mounted) setBranchError('ဤ account အတွက် rider profile မတွေ့ပါ။');
          return;
        }
        if (mounted) setRiderId(profile.rider_id);

        const { data: rider, error: riderError } = await supabase
          .from('riders')
          .select('branch')
          .eq('id', profile.rider_id)
          .maybeSingle();
        if (riderError) throw riderError;
        if (mounted && typeof rider?.branch === 'string' && rider.branch.trim()) {
          setBranch(rider.branch.trim());
          setBranchError('');
        } else if (mounted) {
          setBranchError('Rider profile တွင် branch မသတ်မှတ်ထားပါ။');
        }
      } catch (error) {
        console.error('Unable to load intake branch:', error);
        if (mounted) setBranchError('Rider branch ကို ရယူ၍မရပါ။');
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleBarcodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    const value = data.trim();
    if (!value || value === lastRejectedBarcode.current || scanLocked.current || barcodeStep !== 'scanning') return;
    scanLocked.current = true;
    try {
      const existing = await findExistingBarcode(value);
      if (existing) {
        lastRejectedBarcode.current = value;
        showMessage('Barcode ရှိပြီးသားဖြစ်သည်', `[${value}] ကို စနစ်ထဲတွင် မှတ်တမ်းတင်ပြီးဖြစ်သည်။ အခြား barcode ကို scan ဖတ်ပါ။`);
        setScannedBarcode('');
        return;
      }
      lastRejectedBarcode.current = '';
      setScannedBarcode(value);
      setBarcodeStep('capturing');
    } catch (error) {
      showMessage('Barcode စစ်ဆေး၍မရပါ', errorMessage(error));
    } finally {
      scanLocked.current = false;
    }
  }, [barcodeStep]);

  const startIntake = (mode: IntakeMode) => {
    setIntakeMode(mode);
    setBarcodeStep(mode === 'with-barcode' ? 'scanning' : 'capturing');
    setScannedBarcode('');
    setCameraReady(false);
    setScreen('camera');
  };

  const addImages = (newImages: IntakeImage[], openReview: boolean) => {
    if (newImages.length === 0) return;
    setImages((current) => {
      const next = [...current, ...newImages];
      setSelectedIndex(next.length - 1);
      return next;
    });
    if (openReview) setScreen('review');
    if (intakeMode === 'with-barcode') {
      setBarcodeStep('scanning');
      setScannedBarcode('');
    }
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || !cameraReady || saving) return;
    setSaving(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) throw new Error('ကင်မရာမှ ဓာတ်ပုံမရရှိပါ။');
      addImages([{
        id: makeId('photo'),
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        barcode: intakeMode === 'with-barcode' ? scannedBarcode || null : null,
        quality: 'HD',
      }], false);
    } catch (error) {
      showMessage('ဓာတ်ပုံရိုက်၍မရပါ', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const pickImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (result.canceled) return;
      addImages(result.assets.map((asset) => ({
        id: makeId('gallery'),
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        barcode: intakeMode === 'with-barcode' ? scannedBarcode || null : null,
        quality: 'HD',
      })), true);
    } catch (error) {
      showMessage('Gallery ဖွင့်၍မရပါ', errorMessage(error));
    }
  };

  const removeSelectedImage = () => {
    if (!selectedImage) return;
    setImages((current) => {
      const next = current.filter((image) => image.id !== selectedImage.id);
      setSelectedIndex(Math.max(0, Math.min(selectedIndex, next.length - 1)));
      if (next.length === 0) setScreen('camera');
      return next;
    });
  };

  const saveIntake = async () => {
    if (saving) return;
    if (images.length === 0) {
      showMessage('ဓာတ်ပုံလိုအပ်ပါသည်', 'အနည်းဆုံး ဓာတ်ပုံတစ်ပုံ ရိုက်ပါ သို့မဟုတ် ရွေးပါ။');
      return;
    }
    if (!isValidDateKey(receivedDate)) {
      showMessage('ရက်စွဲမှားနေပါသည်', 'လက်ခံရက်ကို YYYY-MM-DD ပုံစံဖြင့် ထည့်ပါ။');
      return;
    }
    if (!branch) {
      showMessage('Branch မရရှိပါ', branchError || 'Rider profile မှ branch ကို ရယူပြီးမှ သိမ်းဆည်းပါ။');
      return;
    }
    if (!riderId) {
      showMessage('Rider ID မရရှိပါ', 'Rider profile ကို ပြန်စစ်ဆေးပြီးမှ upload လုပ်ပါ။');
      return;
    }

    setSaving(true);
    try {
      const queueItems: QueueItem[] = [];
      for (const image of images) {
        const maxWidth = image.quality === 'HD' ? 1920 : 1280;
        const actions = image.width > maxWidth ? [{ resize: { width: maxWidth } }] : [];
        const compressed = await ImageManipulator.manipulateAsync(
          image.uri,
          actions,
          { compress: image.quality === 'HD' ? 0.92 : 0.88, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (!compressed.base64) throw new Error('ဓာတ်ပုံကို queue အတွက် ပြင်ဆင်၍မရပါ။');
        const transit = branch === 'MDY' && transitToYgn
          ? [{ transit_to: 'YGN', transit_date: receivedDate, transit_from: branch }]
          : null;
        queueItems.push({
          id: makeId('queue'),
          fileBase64: compressed.base64,
          fileName: `${image.id}.jpg`,
          barcode: image.barcode,
          branch,
          rider_id: riderId,
          received_date: receivedDate,
          uploader_note: note.trim() || null,
          transit,
        });
      }
      for (const item of queueItems) await saveQueueItem(item);
      await refreshQueue();
      setImages([]);
      setSelectedIndex(0);
      setNote('');
      setTransitToYgn(false);
      setReceivedDate(todayKey());
      setScreen('queue');
      void runQueue();
    } catch (error) {
      showMessage('Queue ထဲသိမ်း၍မရပါ', errorMessage(error));
      await refreshQueue();
    } finally {
      setSaving(false);
    }
  };

  const submitIntake = () => {
    const message = `${images.length} ပုံကို upload queue ထဲ သိမ်းဆည်းပါမည်။`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(message)) void saveIntake();
      return;
    }
    Alert.alert('Parcel records သိမ်းမည်', message, [
      { text: 'မသိမ်းပါ', style: 'cancel' },
      { text: 'သိမ်းမည်', onPress: () => { void saveIntake(); } },
    ]);
  };

  const removeQueueItem = (item: QueueItem) => {
    const remove = async () => {
      try {
        await deleteStoredQueueItem(item.id);
        setQueueItemErrors((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        delete queueItemErrorsRef.current[item.id];
        await refreshQueue();
      } catch (error) {
        setQueueError(errorMessage(error));
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('ဒီ upload ကို queue မှ ဖျက်မလား?')) void remove();
      return;
    }
    Alert.alert('Queue item ဖျက်မည်', 'ဤဓာတ်ပုံကို upload queue မှ ဖယ်ရှားမည်။', [
      { text: 'မဖျက်ပါ', style: 'cancel' },
      { text: 'ဖျက်မည်', style: 'destructive', onPress: () => { void remove(); } },
    ]);
  };

  const discardDraft = () => {
    const discard = () => {
      setImages([]);
      setSelectedIndex(0);
      setScannedBarcode('');
      setCameraReady(false);
      setScreen('choose');
    };

    if (images.length === 0) {
      discard();
      return;
    }

    const message = 'ရိုက်ထားသော ဓာတ်ပုံများကို ဖယ်ရှားပြီး intake ရွေးချယ်မှုသို့ ပြန်သွားမည်။';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(message)) discard();
      return;
    }
    Alert.alert('Intake ကိုပယ်ဖျက်မည်လား?', message, [
      { text: 'ဆက်လုပ်မည်', style: 'cancel' },
      { text: 'ပယ်ဖျက်မည်', style: 'destructive', onPress: discard },
    ]);
  };

  const goBack = () => {
    if (screen === 'queue') {
      setScreen('choose');
      return;
    }
    if (screen === 'review') {
      setScreen('camera');
      return;
    }
    if (screen === 'camera') {
      discardDraft();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {screen === 'choose' && (
        <ScrollView style={styles.page} contentContainerStyle={styles.content}>
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="နောက်သို့" onPress={goBack} style={styles.iconButton}>
              <Ionicons name="chevron-back" size={19} color={palette.text} />
            </Pressable>
            <Text style={styles.headerTitle}>PARCEL INTAKE · {branch || '...'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Upload queue ဖွင့်ရန်" onPress={() => setScreen('queue')} style={styles.iconButton}>
              <Ionicons name="cloud-upload-outline" size={19} color={palette.orange} />
            </Pressable>
          </View>
          <View style={styles.hero}>
            <View style={styles.heroMark}><Ionicons name="cube-outline" size={21} color={palette.orange} /></View>
            <Text style={styles.eyebrow}>INBOUND OPERATIONS</Text>
            <Text style={styles.title}>ပါဆယ် အဝင်သွင်းရန်</Text>
           
          </View>
          {branchError ? <View style={styles.errorBanner}><Text style={styles.errorText}>{branchError}</Text></View> : null}
          <Pressable accessibilityRole="button" onPress={() => startIntake('without-barcode')} style={styles.methodCard}>
            <View style={styles.methodIcon}><Ionicons name="camera-outline" size={22} color={palette.orange} /></View>
            <View style={styles.methodCopy}>
              <Text style={styles.methodTitle}>Barcode မပါဘဲ ပုံရိုက်မည်</Text>
              <Text style={styles.methodDescription}>ပါဆယ်ဓာတ်ပုံရိုက်ပြီး မှတ်ချက်ထည့်ပါ</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={palette.muted} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => startIntake('with-barcode')} style={[styles.methodCard, styles.methodCardPrimary]}>
            <View style={[styles.methodIcon, styles.methodIconPrimary]}><Ionicons name="barcode-outline" size={23} color={palette.orange} /></View>
            <View style={styles.methodCopy}>
              <Text style={styles.methodTitle}>Barcode scan ပြီး ပုံရိုက်မည်</Text>
              <Text style={styles.methodDescription}>Barcode ကို စစ်ဆေးပြီး ဓာတ်ပုံနဲ့ တွဲမှတ်တမ်းတင်ပါ</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#c2410c" />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setScreen('queue')} style={styles.queueLink}>
            <View style={styles.queueLinkIcon}><Ionicons name="cloud-upload-outline" size={18} color={palette.orange} /></View>
            <View style={styles.queueLinkCopy}>
              <Text style={styles.queueLinkTitle}>UPLOAD QUEUE</Text>
              <Text style={styles.queueLinkSubtitle}>{queue.length ? `${queue.length} ပုံ upload လုပ်ရန်ကျန်` : 'Queue ရှင်းလင်းနေသည်'}</Text>
            </View>
            <Text style={styles.queueCount}>{queue.length}</Text>
            <Ionicons name="chevron-forward" size={15} color={palette.muted} />
          </Pressable>
        </ScrollView>
      )}

      {screen === 'camera' && (
        <View style={styles.cameraScreen}>
          <View style={styles.cameraTopBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="နောက်သို့" onPress={goBack} style={styles.cameraHeaderButton}>
              <Ionicons name="chevron-back" size={19} color="#ffffff" />
            </Pressable>
            <View>
              <View style={styles.cameraModePill}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffad70' }} />
                <Text style={styles.cameraModeText}>{intakeMode === 'with-barcode' ? barcodeStep === 'scanning' ? 'SCAN BARCODE' : 'TAKE PHOTO' : 'CAPTURE PARCEL'}</Text>
              </View>
              <Text style={styles.cameraInstruction}>{barcodeStep === 'scanning' && intakeMode === 'with-barcode' ? 'Barcode ကို frame ထဲတွင် ချိန်ပါ' : 'ပါဆယ်ကို အလယ်တွင်ထားပြီး ရိုက်ပါ'}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ကင်မရာပြောင်းရန်"
              onPress={() => {
                setCameraReady(false);
                setCameraFacing((current) => current === 'back' ? 'front' : 'back');
              }}
              style={styles.cameraHeaderButton}
            >
              <Ionicons name="camera-reverse-outline" size={20} color="#ffffff" />
            </Pressable>
          </View>
          <View style={styles.cameraFrame}>
            {!permission?.granted ? (
              <View style={styles.permissionPanel}>
                <Text style={styles.permissionTitle}>Camera ခွင့်ပြုချက်လိုအပ်ပါသည်</Text>
                <Text style={styles.permissionDescription}>Barcode scan နှင့် ဓာတ်ပုံရိုက်ရန် camera ခွင့်ပြုပါ။</Text>
                <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>CAMERA ဖွင့်ရန်</Text>
                </Pressable>
              </View>
            ) : (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={cameraFacing}
                mode="picture"
                onCameraReady={() => setCameraReady(true)}
                barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'pdf417'] }}
                onBarcodeScanned={intakeMode === 'with-barcode' && barcodeStep === 'scanning' ? handleBarcodeScanned : undefined}
              />
            )}
            {intakeMode === 'with-barcode' && barcodeStep === 'scanning' && permission?.granted && (
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={styles.scanHint}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffad70' }} /><Text style={styles.scanHintText}>Barcode ကို frame အတွင်းထားပါ</Text></View>
                <View style={styles.scanFrame} />
              </View>
            )}
            {scannedBarcode !== '' && barcodeStep === 'capturing' && (
              <View style={styles.scannedBadge}>
                <Ionicons name="barcode-outline" size={19} color="#ffad70" />
                <View style={styles.scannedTextWrap}>
                  <Text style={styles.scannedLabel}>SCANNED BARCODE</Text>
                  <Text numberOfLines={1} style={styles.scannedValue}>{scannedBarcode}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Barcode ပြန် scan ဖတ်ရန်" onPress={() => { lastRejectedBarcode.current = ''; setScannedBarcode(''); setBarcodeStep('scanning'); }}>
                  <Ionicons name="refresh" size={19} color="#ffffff" />
                </Pressable>
              </View>
            )}
            {images.length > 0 && (
              <View style={styles.thumbnailDock}>
                <View style={styles.thumbnailHeader}><Text style={styles.thumbnailHeaderText}>CAPTURED PHOTOS</Text><Text style={styles.thumbnailHeaderText}>{images.length}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
                  {images.map((image, index) => (
                    <Pressable key={image.id} accessibilityRole="button" accessibilityLabel={`ဓာတ်ပုံ ${index + 1} ကို review လုပ်ရန်`} onPress={() => { setSelectedIndex(index); setScreen('review'); }} style={styles.thumbnail}>
                      <Image source={{ uri: image.uri }} style={styles.thumbnailImage} />
                      {image.barcode ? <View style={styles.thumbnailBarcode}><Text numberOfLines={1} style={styles.thumbnailBarcodeText}>{image.barcode}</Text></View> : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          <View style={styles.cameraControls}>
            {intakeMode === 'with-barcode' && barcodeStep === 'scanning' ? <View style={styles.cameraControlButton} /> : (
              <Pressable accessibilityRole="button" accessibilityLabel="Gallery မှ ပုံရွေးရန်" onPress={() => void pickImages()} style={styles.cameraControlButton}>
                <Ionicons name="images-outline" size={20} color="#ffffff" />
                <Text style={styles.cameraControlLabel}>GALLERY</Text>
              </Pressable>
            )}
            {intakeMode === 'with-barcode' && barcodeStep === 'scanning' ? (
              <View style={styles.scanShutter}><Ionicons name="barcode-outline" size={26} color="#17100a" /></View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="ဓာတ်ပုံရိုက်ရန်" disabled={!cameraReady || saving} onPress={() => void capturePhoto()} style={[styles.shutterOuter, (!cameraReady || saving) && styles.disabled]}>
                {saving ? <ActivityIndicator color={palette.orange} /> : <View style={styles.shutterInner} />}
              </Pressable>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={`${images.length} ပုံကို review လုပ်ရန်`} disabled={images.length === 0} onPress={() => setScreen('review')} style={[styles.cameraControlButton, images.length === 0 && styles.disabled]}>
              <Ionicons name="grid-outline" size={19} color="#ffad70" />
              <Text style={styles.cameraControlLabel}>REVIEW {images.length || ''}</Text>
            </Pressable>
          </View>
          <Text style={styles.cameraFooter}>{intakeMode === 'with-barcode' ? barcodeStep === 'scanning' ? 'Barcode scan ပြီး ဓာတ်ပုံရိုက်ပါ' : 'ဓာတ်ပုံရိုက်ပြီး နောက် barcode ကို scan ဖတ်ပါ' : 'ဓာတ်ပုံများ ရိုက်ပြီး review လုပ်ပါ'}</Text>
        </View>
      )}

      {screen === 'review' && selectedImage && (
        <KeyboardAvoidingView style={styles.reviewPage} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.reviewToolbar}>
              <Pressable accessibilityRole="button" accessibilityLabel="ကင်မရာသို့ပြန်ရန်" onPress={() => setScreen('camera')} style={styles.iconButton}>
                <Ionicons name="chevron-back" size={18} color={palette.text} />
              </Pressable>
              <View style={styles.reviewTitleWrap}>
                <Text style={styles.reviewEyebrow}>INTAKE · PHOTO REVIEW</Text>
                <Text style={styles.sectionTitle}>ဓာတ်ပုံစစ်ဆေးရန်</Text>
              </View>
              <Text style={styles.counter}>{String(selectedIndex + 1).padStart(2, '0')} / {String(images.length).padStart(2, '0')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="ဓာတ်ပုံဖျက်ရန်" onPress={removeSelectedImage} style={[styles.iconButton, { borderColor: '#fecaca' }]}>
                <Ionicons name="trash-outline" size={17} color={palette.red} />
              </Pressable>
            </View>
            <View style={styles.previewFrame}>
              <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} resizeMode="contain" />
              {selectedImage.barcode ? <View style={styles.previewBarcode}><Text numberOfLines={1} style={styles.previewBarcodeText}>{selectedImage.barcode}</Text></View> : null}
              {images.length > 1 && <>
                <Pressable accessibilityRole="button" accessibilityLabel="ယခင်ဓာတ်ပုံ" onPress={() => setSelectedIndex((index) => (index - 1 + images.length) % images.length)} style={[styles.previewNav, styles.previewNavLeft]}><Ionicons name="chevron-back" size={18} color="#ffffff" /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="နောက်ဓာတ်ပုံ" onPress={() => setSelectedIndex((index) => (index + 1) % images.length)} style={[styles.previewNav, styles.previewNavRight]}><Ionicons name="chevron-forward" size={18} color="#ffffff" /></Pressable>
              </>}
            </View>
            <View style={styles.form}>
              <View style={styles.formHeader}>
                <View><Text style={styles.reviewEyebrow}>RECORD DETAILS</Text><Text style={styles.sectionTitle}>Parcel information</Text></View>
                <View style={styles.qualityControl}>
                  {(['SD', 'HD'] as const).map((quality) => (
                    <Pressable key={quality} accessibilityRole="button" accessibilityState={{ selected: selectedImage.quality === quality }} onPress={() => setImages((current) => current.map((image, index) => index === selectedIndex ? { ...image, quality } : image))} style={[styles.qualityOption, selectedImage.quality === quality && styles.qualitySelected]}>
                      <Text style={[styles.qualityText, selectedImage.quality === quality && styles.qualityTextSelected]}>{quality}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.column}>
                  <Text style={styles.fieldLabel}>RECEIVED DATE</Text>
                  <TextInput accessibilityLabel="လက်ခံရက်" value={receivedDate} onChangeText={setReceivedDate} placeholder="YYYY-MM-DD" placeholderTextColor={palette.muted} autoCapitalize="none" style={styles.input} />
                </View>
                {branch === 'MDY' && (
                  <View style={styles.column}>
                    <Text style={styles.fieldLabel}>TRANSIT</Text>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: transitToYgn }} onPress={() => setTransitToYgn((current) => !current)} style={styles.transitToggle}>
                      <View style={[styles.checkbox, transitToYgn && styles.checkboxSelected]}>{transitToYgn && <Ionicons name="checkmark" size={13} color="#17100a" />}</View>
                      <Text style={styles.transitLabel}>Yangon (YGN) သို့</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <Text style={styles.fieldLabel}>CAPTION / NOTE</Text>
              <TextInput accessibilityLabel="Caption သို့မဟုတ် မှတ်ချက်" value={note} onChangeText={setNote} placeholder="မှတ်ချက်ထည့်ပါ..." placeholderTextColor={palette.muted} returnKeyType="done" style={styles.input} />
              <Pressable accessibilityRole="button" disabled={saving} onPress={submitIntake} style={[styles.primaryButton, saving && styles.disabled]}>
                {saving ? <ActivityIndicator color="#17100a" /> : <><Text style={styles.primaryButtonText}>SAVE TO QUEUE · {images.length} PHOTO{images.length === 1 ? '' : 'S'}</Text><Ionicons name="arrow-forward" size={15} color="#17100a" /></>}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {screen === 'queue' && (
        <ScrollView style={styles.queuePage} contentContainerStyle={styles.queueContent}>
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="နောက်သို့" onPress={goBack} style={styles.iconButton}><Ionicons name="chevron-back" size={19} color={palette.text} /></Pressable>
            <Text style={styles.headerTitle}>UPLOAD QUEUE</Text>
            <View style={styles.headerSpacer} />
          </View>
          <View style={styles.queueSummary}>
            <View style={[styles.statusDot, queueStatus === 'uploading' && styles.statusUploading, queueStatus === 'success' && styles.statusSuccess, queueStatus === 'error' && styles.statusError]} />
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryText}>{queueStatus === 'uploading' ? 'Uploading records' : queueStatus === 'error' ? 'Upload မပြီးသေးပါ' : queueStatus === 'success' ? 'Sync complete' : 'Offline queue'}</Text>
              <Text style={styles.summaryHint}>{queue.length ? `${queue.length} ပုံ upload လုပ်ရန်ကျန်` : 'တင်ရန်ကျန်သော ပုံမရှိပါ'}</Text>
            </View>
            {queueStatus === 'uploading' && <ActivityIndicator color={palette.orange} />}
          </View>
          {queueError ? <View style={styles.errorBanner}><Text style={styles.errorText}>{queueError}</Text></View> : null}
          {queue.length > 0 && <Pressable accessibilityRole="button" disabled={queueStatus === 'uploading'} onPress={() => void runQueue()} style={[styles.primaryButton, queueStatus === 'uploading' && styles.disabled]}><Ionicons name="refresh" size={16} color="#17100a" /><Text style={styles.primaryButtonText}>RETRY ALL UPLOADS</Text></Pressable>}
          {queue.length === 0 && queueStatus !== 'uploading' && <View style={styles.emptyQueue}><Ionicons name="checkmark-circle-outline" size={35} color={palette.green} /><Text style={styles.emptyTitle}>တင်ရန်ကျန်သော ပုံမရှိပါ</Text><Text style={styles.emptyHint}>သိမ်းထားသော parcel records များ sync ပြီးပါပြီ။</Text></View>}
          {queue.map((item) => (
            <View key={item.id} style={styles.queueCard}>
              <Image source={{ uri: `data:image/jpeg;base64,${item.fileBase64}` }} style={styles.queueImage} />
              <View style={styles.queueItemCopy}>
                <Text numberOfLines={1} style={styles.queueItemTitle}>{item.barcode || 'No barcode'}</Text>
                <Text style={styles.queueItemMeta}>{item.branch} · {item.received_date}</Text>
                {item.uploader_note ? <Text numberOfLines={2} style={styles.queueItemNote}>{item.uploader_note}</Text> : null}
                {queueItemErrors[item.id] ? <Text style={styles.queueItemError}>{queueItemErrors[item.id]}</Text> : null}
              </View>
              <View style={styles.queueActions}>
                <Pressable accessibilityRole="button" accessibilityLabel="ဒီပုံကို ပြန်တင်ရန်" disabled={queueStatus === 'uploading'} onPress={() => void runQueue(item.id)} style={[styles.retryButton, queueStatus === 'uploading' && styles.disabled]}><Text style={styles.retryText}>RETRY</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Queue မှဖျက်ရန်" disabled={queueStatus === 'uploading'} onPress={() => removeQueueItem(item)} style={[styles.deleteButton, queueStatus === 'uploading' && styles.disabled]}><Ionicons name="trash-outline" size={16} color={palette.red} /></Pressable>
              </View>
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>BACK TO HOME</Text></Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
