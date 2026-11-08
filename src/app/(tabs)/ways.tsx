import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ParcelCard, type ParcelCardData } from '../../components/parcel-card';
import { PageLoadingSkeleton } from '../../components/page-loading-skeleton';
import { PullToRefreshControl } from '../../components/pull-to-refresh-control';
import { supabase } from '../../lib/supabase';
import { useAppTheme, useThemeStyles } from '../../lib/theme-provider';
import { recordOrderStatusHistory } from '../../lib/update-order-status';

type Way = ParcelCardData & {
  status?: string | null;
};

const PAGE_SIZE = 100;
const MAX_PROOF_IMAGE_WIDTH = 1280;

function formatAmount(amount: number | string | null) {
  if (amount == null || amount === '') return '-';
  const value = Number(amount);
  return Number.isNaN(value) ? `${amount} ကျပ်` : `${value.toLocaleString()} ကျပ်`;
}

export default function WaysScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const params = useLocalSearchParams<{ autoScan?: string }>();
  const [ways, setWays] = useState<Way[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [riderId, setRiderId] = useState<string | number | null>(null);
  const [notice, setNotice] = useState('');

  // Barcode scanner states
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scannedWay, setScannedWay] = useState<Way | null>(null);
  const [scanLookupLoading, setScanLookupLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const scanLocked = useRef(false);

  const filteredWays = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ways;
    return ways.filter((item) =>
      [
        item.id,
        item.item_id,
        item.barcode,
        item.receiver_name,
        item.receiver_phone,
        item.receiver_address,
        item.sender_name,
      ].some((field) => field != null && String(field).toLowerCase().includes(q))
    );
  }, [search, ways]);

  // Delivery proof modal states
  const [proofModalVisible, setProofModalVisible] = useState(false);
  const [selectedWay, setSelectedWay] = useState<Way | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<{ uri: string } | null>(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<'location' | 'upload' | null>(null);
  const [modalError, setModalError] = useState('');
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const loadWays = useCallback(async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const email = session?.user.email;
      if (!email) {
        router.replace('/login');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('rider_id')
        .eq('email', email)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.rider_id) {
        setWays([]);
        setRiderId(null);
        setError('ဤ email အတွက် rider profile မတွေ့ပါ။');
        return;
      }
      setRiderId(profile.rider_id);

      const allWays: Way[] = [];

      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: queryError } = await supabase
          .from('orders')
          .select('id, item_id, barcode, sender_name, receiver_name, receiver_phone, receiver_address, cod_amount, deli_fee, total_amount, image_url, status')
          .eq('deliver_rider_id', profile.rider_id)
          .eq('status', 'On Way')
          .eq('is_deleted', false)
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (queryError) throw queryError;

        const page = (data ?? []) as Way[];
        allWays.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      setWays(allWays);
      setError('');
    } catch {
      setError('Way စာရင်းကို ရယူ၍မရပါ။ အင်တာနက် သို့မဟုတ် database ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadWays();
    }, [loadWays]),
  );

  const openDeliveryProof = useCallback(async (way: Way) => {
    setNotice('');
    setModalError('');
    setSelectedWay(way);
    setCapturedPhoto(null);
    setTorch(false);

    if (Platform.OS === 'web') {
      setProofModalVisible(true);
      return;
    }

    try {
      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();

      if (!permission.granted) {
        Alert.alert(
          'Camera ခွင့်ပြုချက် လိုအပ်ပါသည်',
          'ပို့ဆောင်မှု သက်သေဓာတ်ပုံ ရိုက်ကူးရန် Camera ခွင့်ပြုချက် ပေးရန်လိုအပ်ပါသည်။'
        );
        return;
      }

      setProofModalVisible(true);
    } catch {
      Alert.alert('အမှား', 'Camera ကို ဖွင့်၍မရပါ။ စက်၏ ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    }
  }, [cameraPermission, requestCameraPermission]);

  const closeProofModal = useCallback(() => {
    if (submitting) return;
    setProofModalVisible(false);
    setSelectedWay(null);
    setCapturedPhoto(null);
    setModalError('');
    setTorch(false);
  }, [submitting]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || takingPhoto) return;
    setTakingPhoto(true);
    setModalError('');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.75,
        base64: false,
        skipProcessing: false,
      });

      if (!photo || !photo.uri) {
        throw new Error('ဓာတ်ပုံရိုက်၍ မရပါ။');
      }

      // Crop to 3:4 aspect ratio
      const rawWidth = photo.width || 0;
      const rawHeight = photo.height || 0;
      const actions: Action[] = [];
      let cropWidth = rawWidth;

      if (rawWidth > 0 && rawHeight > 0) {
        // Target 3:4 aspect ratio (width:height = 3:4)
        const targetRatio = 3 / 4;
        let cropHeight = rawHeight;
        let originX = 0;
        let originY = 0;

        if (rawWidth / rawHeight > targetRatio) {
          // Image is wider than 3:4, crop the horizontal sides
          cropWidth = Math.round(rawHeight * targetRatio);
          originX = Math.round((rawWidth - cropWidth) / 2);
        } else {
          // Image is taller than 3:4, crop top & bottom
          cropHeight = Math.round(rawWidth / targetRatio);
          originY = Math.round((rawHeight - cropHeight) / 2);
        }

        actions.push({ crop: { originX, originY, width: cropWidth, height: cropHeight } });
      }

      if (cropWidth > MAX_PROOF_IMAGE_WIDTH) {
        actions.push({ resize: { width: MAX_PROOF_IMAGE_WIDTH } });
      }

      const image = await manipulateAsync(
        photo.uri,
        actions,
        { compress: 0.65, format: SaveFormat.JPEG },
      );
      setCapturedPhoto({ uri: image.uri });
    } catch (err: any) {
      setModalError(err?.message || 'ဓာတ်ပုံရိုက်ရာတွင် အမှားတစ်ခု ဖြစ်ပေါ်ခဲ့ပါသည်။');
    } finally {
      setTakingPhoto(false);
    }
  }, [takingPhoto]);

  const selectDeliveryPhoto = useCallback(async () => {
    if (takingPhoto || submitting) return;
    setTakingPhoto(true);
    setModalError('');

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('ရွေးထားသော ဓာတ်ပုံကို ဖတ်၍မရပါ။');

      const actions: Action[] = asset.width > MAX_PROOF_IMAGE_WIDTH
        ? [{ resize: { width: MAX_PROOF_IMAGE_WIDTH } }]
        : [];
      const image = await manipulateAsync(
        asset.uri,
        actions,
        { compress: 0.65, format: SaveFormat.JPEG },
      );
      setCapturedPhoto({ uri: image.uri });
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'ဓာတ်ပုံရွေး၍မရပါ။ ပြန်ကြိုးစားပါ။');
    } finally {
      setTakingPhoto(false);
    }
  }, [submitting, takingPhoto]);

  const submitDeliveryProof = useCallback(async () => {
    if (!selectedWay || !capturedPhoto || submitting) return;

    setSubmitting(true);
    setSubmitStage('location');
    setModalError('');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Delivered မလုပ်မီ တည်နေရာခွင့်ပြုချက် ပေးရန်လိုအပ်ပါသည်။');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = position.coords;

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) {
        throw new Error('အကောင့်ဝင်ထားရန် လိုအပ်ပါသည်။ ကျေးဇူးပြု၍ ပြန်လည် login ဝင်ပါ။');
      }

      setSubmitStage('upload');
      const photoFile = Platform.OS === 'web'
        ? await fetch(capturedPhoto.uri).then(async (response) => {
          if (!response.ok) throw new Error('ရွေးထားသော ဓာတ်ပုံကို ဖတ်၍မရပါ။');
          return response.blob();
        })
        : new ExpoFile(capturedPhoto.uri);
      if (photoFile.size === 0 || photoFile.size > 9_000_000) {
        throw new Error('သက်သေဓာတ်ပုံသည် 9 MB ထက်ငယ်ရပါမည်။');
      }

      const body = new FormData();
      body.append('orderId', String(selectedWay.id));
      body.append('proof', photoFile, `delivery-${selectedWay.id}.jpg`);
      body.append('latitude', String(latitude));
      body.append('longitude', String(longitude));

      const { data, error: functionError } = await supabase.functions.invoke('deliver-with-proof', {
        body,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (functionError) {
        let message = functionError.message;
        try {
          if ('context' in functionError && (functionError as any).context) {
            const ctx = (functionError as any).context;
            if (typeof ctx.json === 'function') {
              const json = await ctx.json();
              if (json?.error) message = json.error;
            }
          }
        } catch {}
        throw new Error(message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (riderId) {
        try {
          await recordOrderStatusHistory({
            orderId: selectedWay.id,
            riderId,
            previousStatus: 'On Way',
            currentStatus: 'Delivered',
          });
        } catch (historyErr) {
          console.warn('Failed to record order history:', historyErr);
        }
      }

      setWays((current) => current.filter((item) => item.id !== selectedWay.id));
      setScannedWay((current) => (current?.id === selectedWay.id ? null : current));
      setNotice(`Way #${selectedWay.id} ကို Delivered အဖြစ် အောင်မြင်စွာ ပြောင်းလဲပြီး Telegram သို့ ပုံပို့ပြီးပါပြီ။`);
      setProofModalVisible(false);
      setSelectedWay(null);
      setCapturedPhoto(null);
    } catch (err: any) {
      setModalError(err?.message || 'Delivered လုပ်၍ မရပါ။ Telegram ဆာဗာ သို့မဟုတ် အင်တာနက်ကို စစ်ဆေးပါ။');
    } finally {
      setSubmitting(false);
      setSubmitStage(null);
    }
  }, [capturedPhoto, riderId, selectedWay, submitting]);

  const handleBarcodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    if (scanLocked.current) return;
    const value = data.trim();
    if (!value) return;

    scanLocked.current = true;
    setScannerVisible(false);
    setScanResult(value);
    setScannedWay(null);
    setScanMessage('');
    setScanLookupLoading(true);

    try {
      const normalizedValue = value.toLowerCase();
      // First check in loaded ways
      const localMatch = ways.find((way) =>
        [way.item_id, way.barcode, way.id].some((identifier) =>
          identifier != null && String(identifier).trim().toLowerCase() === normalizedValue,
        ),
      );

      if (localMatch) {
        setScannedWay(localMatch);
        return;
      }

      // If not in currently loaded ways, query Supabase for this rider's On Way order
      if (riderId) {
        const columns = 'id, item_id, barcode, sender_name, receiver_name, receiver_phone, receiver_address, cod_amount, deli_fee, total_amount, image_url, status';
        const lookup = async (column: 'item_id' | 'barcode' | 'id') => {
          const { data: order, error: lookupError } = await supabase
            .from('orders')
            .select(columns)
            .eq('deliver_rider_id', riderId)
            .eq('status', 'On Way')
            .eq('is_deleted', false)
            .eq(column, value)
            .limit(1)
            .maybeSingle();
          if (lookupError) return null;
          return order as Way | null;
        };

        const dbMatch = (await lookup('item_id')) ?? (await lookup('barcode')) ?? (await lookup('id'));
        if (dbMatch) {
          setScannedWay(dbMatch);
          return;
        }
      }

      setScanMessage('ဒီ item_id သို့မဟုတ် barcode နဲ့ကိုက်တဲ့ On Way ပါဆယ် မတွေ့ပါ။');
    } catch {
      setScanMessage('Scan result ကို ရှာမရပါ။ item_id/barcode column နှင့် အင်တာနက်ကို စစ်ဆေးပါ။');
    } finally {
      setScanLookupLoading(false);
      scanLocked.current = false;
    }
  }, [riderId, ways]);

  const openScanner = useCallback(async () => {
    setNotice('');
    setScanResult(null);
    setScannedWay(null);
    setScanMessage('');

    try {
      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();

      if (!permission.granted) {
        Alert.alert('Camera ခွင့်ပြုချက် လိုအပ်ပါသည်', 'QR/Barcode ဖတ်ရန် Camera ခွင့်ပြုချက် ပေးရန်လိုအပ်ပါသည်။');
        return;
      }
      setScannerVisible(true);
    } catch {
      Alert.alert('အမှား', 'Camera ကို ဖွင့်၍မရပါ။ ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    }
  }, [cameraPermission, requestCameraPermission]);

  const closeScanner = useCallback(() => {
    setScannerVisible(false);
    setScanResult(null);
    setScannedWay(null);
    setScanMessage('');
    setScanLookupLoading(false);
  }, []);

  useEffect(() => {
    if (params.autoScan === '1') {
      void openScanner();
      router.setParams({ autoScan: undefined });
    }
  }, [params.autoScan, openScanner]);

  const renderWay = ({ item }: { item: Way }) => (
    <ParcelCard
      parcel={item}
      action={
        <TouchableOpacity
          style={styles.deliverButton}
          onPress={() => { void openDeliveryProof(item); }}
          accessibilityRole="button"
          accessibilityLabel="Delivered ပြုလုပ်ရန်"
        >
          <Ionicons name="checkmark" size={15} color="#ffffff" />
          <Text style={styles.deliverButtonText}>Delivered</Text>
        </TouchableOpacity>
      }
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>On Ways</Text>
          {!loading && <Text style={styles.count}>{ways.length}</Text>}
        </View>
        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.pendingButton}
            onPress={() => router.push('/pending-ways')}
            accessibilityRole="button"
          >
            <Ionicons name="time-outline" size={18} color="#f97316" />
            <Text style={styles.pendingButtonText}>Pending</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => { void openScanner(); }}
            accessibilityRole="button"
            accessibilityLabel="Barcode Scan"
          >
            <Ionicons name="barcode-outline" size={20} color="#f97316" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={19} color={isDark ? '#94a3b8' : '#64748b'} />
        <TextInput
          style={styles.searchInput}
          placeholder="Way ID, Barcode, အမည်, ဖုန်းဖြင့် ရှာရန်..."
          placeholderTextColor={isDark ? '#64748b' : '#94a3b8'}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="ရှာဖွေမှု ဖျက်မည်">
            <Ionicons name="close-circle" size={18} color={isDark ? '#94a3b8' : '#64748b'} />
          </TouchableOpacity>
        )}
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {loading ? (
        <PageLoadingSkeleton isDark={isDark} />
      ) : error ? (
        <View style={styles.stateContainer}>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void loadWays(); }}>
            <Text style={styles.retryText}>ပြန်ကြိုးစားမည်</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={filteredWays}
          renderItem={renderWay}
          keyExtractor={(item) => String(item.id)}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          windowSize={5}
          contentContainerStyle={filteredWays.length ? styles.content : styles.emptyContent}
          refreshControl={
            <PullToRefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void loadWays(); }}
              tintColor="#f97316"
            />
          }
          ListEmptyComponent={
            <Text style={styles.stateText}>
              {search.trim() ? 'ရှာဖွေမှုနှင့် ကိုက်ညီသော way မတွေ့ပါ။' : 'ပြသနိုင်သော way မရှိပါ။'}
            </Text>
          }
        />
      )}

      {/* Barcode / QR Scanner Modal */}
      <Modal
        visible={scannerVisible || scanResult !== null}
        animationType="slide"
        onRequestClose={closeScanner}
      >
        {scannerVisible ? (
          <View style={styles.scannerContainer}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  'qr',
                  'code128',
                  'code39',
                  'code93',
                  'ean13',
                  'ean8',
                  'upc_a',
                  'upc_e',
                  'itf14',
                  'codabar',
                  'pdf417',
                  'aztec',
                  'datamatrix',
                ],
              }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <SafeAreaView style={styles.scannerOverlay}>
              <View style={styles.scannerHeader}>
                <Text style={styles.scannerTitle}>QR / Barcode Scan</Text>
                <TouchableOpacity onPress={closeScanner} accessibilityRole="button" accessibilityLabel="ပိတ်ရန်">
                  <Ionicons name="close-circle" size={32} color="#ffffff" />
                </TouchableOpacity>
              </View>
              <View style={styles.scanFrame} />
              <Text style={styles.scannerHint}>QR သို့ Barcode ကို ဘောင်အတွင်းထားပြီး ဖတ်ပါ</Text>
            </SafeAreaView>
          </View>
        ) : (
          <SafeAreaView style={styles.scanResultContainer}>
            <View style={styles.scanResultHeader}>
              <Text style={styles.scanResultTitle}>Scan Result</Text>
              <TouchableOpacity onPress={closeScanner} accessibilityRole="button" accessibilityLabel="ပိတ်ရန်">
                <Ionicons name="close" size={26} color="#0f172a" />
              </TouchableOpacity>
            </View>
            <Text style={styles.scanCode} numberOfLines={2}>Barcode: {scanResult}</Text>
            {scanLookupLoading ? (
              <View style={styles.stateContainer}>
                <ActivityIndicator size="large" color="#0284c7" />
                <Text style={styles.stateText}>ပါဆယ်အချက်အလက်ကို ရှာနေပါသည်...</Text>
              </View>
            ) : scannedWay ? (
              <FlatList
                data={[scannedWay]}
                renderItem={renderWay}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={styles.scanMatchContent}
              />
            ) : (
              <View style={styles.stateContainer}>
                <Text style={styles.stateText}>{scanMessage}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => { void openScanner(); }}>
                  <Text style={styles.retryText}>ထပ် Scan ဖတ်မည်</Text>
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        )}
      </Modal>

      <Modal
        visible={proofModalVisible}
        animationType="slide"
        onRequestClose={closeProofModal}
      >
        <SafeAreaView style={styles.modalContainer}>
          {capturedPhoto ? (
            <View style={styles.previewContainer}>
              <View style={styles.modalHeader}>
                <TouchableOpacity
                  style={styles.closeIconButton}
                  onPress={closeProofModal}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="ပိတ်ရန်"
                >
                  <Ionicons name="close" size={26} color="#ffffff" />
                </TouchableOpacity>
                <View style={styles.modalHeaderCenter}>
                  <Text style={styles.modalHeaderTitle}>ပို့ဆောင်မှု သက်သေပုံ အတည်ပြုရန်</Text>
                  {selectedWay && (
                    <Text style={styles.modalHeaderSubtitle} numberOfLines={1}>
                    {selectedWay.receiver_name || '-'}
                    </Text>
                  )}
                </View>
                <View style={styles.headerRightSpacer} />
              </View>

              <View style={styles.previewImageWrapper}>
                <Image
                  source={{ uri: capturedPhoto.uri }}
                  style={styles.previewImage}
                  contentFit="contain"
                  accessibilityLabel="သက်သေဓာတ်ပုံ"
                />
              </View>

              {modalError ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={18} color="#ef4444" />
                  <Text style={styles.errorBannerText}>{modalError}</Text>
                </View>
              ) : null}

              <View style={styles.previewBottomBar}>
                <TouchableOpacity
                  style={[styles.retakeButton, submitting && styles.buttonDisabled]}
                  onPress={() => { setCapturedPhoto(null); setModalError(''); }}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="ပြန်ရိုက်မည်"
                >
                  <Ionicons name="refresh-outline" size={18} color="#0f172a" />
                  <Text style={styles.retakeButtonText}>ပြန်ရိုက်မည်</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.confirmButton, submitting && styles.buttonDisabled]}
                  onPress={() => { void submitDeliveryProof(); }}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Delivered အတည်ပြုမည်"
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="checkmark-circle-outline" size={19} color="#ffffff" />
                  )}
                  <Text style={styles.confirmButtonText}>
                    {submitStage === 'location'
                      ? 'တည်နေရာ ရယူနေပါသည်...'
                      : submitStage === 'upload'
                        ? 'သက်သေပုံ ပို့နေပါသည်...'
                        : 'Delivered အတည်ပြုမည်'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.cameraContainer}>
              <View style={styles.camera34Frame}>
                {Platform.OS === 'web' ? (
                  <View style={styles.viewfinderCenterArea}>
                    <Ionicons name="images-outline" size={48} color="#cbd5e1" />
                    <Text style={styles.cameraHintText}>ဖုန်းထဲမှ သက်သေဓာတ်ပုံကို ရွေးပါ</Text>
                  </View>
                ) : (
                  <>
                    <CameraView
                      ref={cameraRef}
                      style={StyleSheet.absoluteFill}
                      facing={facing}
                      enableTorch={torch}
                    />
                    <View style={styles.ratioBadge}>
                      <Text style={styles.ratioBadgeText}>3:4</Text>
                    </View>
                  </>
                )}
              </View>

              <SafeAreaView style={styles.cameraOverlay}>
                <View style={styles.cameraTopBar}>
                  <TouchableOpacity
                    style={styles.cameraTopIconButton}
                    onPress={closeProofModal}
                    disabled={takingPhoto}
                    accessibilityRole="button"
                    accessibilityLabel="ပိတ်ရန်"
                  >
                    <Ionicons name="close" size={26} color="#ffffff" />
                  </TouchableOpacity>

                  <View style={styles.cameraTopInfo}>
                    <Text style={styles.cameraTopTitle}>ပို့ဆောင်မှု ဓာတ်ပုံရိုက်ပါ</Text>
                    {selectedWay && (
                      <Text style={styles.cameraTopSubtitle} numberOfLines={1}>
                        Way #{selectedWay.id} • {selectedWay.receiver_name || '-'}
                      </Text>
                    )}
                  </View>

                  {Platform.OS !== 'web' ? (
                    <View style={styles.cameraTopActions}>
                      <TouchableOpacity
                        style={styles.cameraTopIconButton}
                        onPress={() => setTorch((prev) => !prev)}
                        accessibilityRole="button"
                        accessibilityLabel="Flash ဖွင့်/ပိတ်"
                      >
                        <Ionicons
                          name={torch ? 'flash' : 'flash-off-outline'}
                          size={22}
                          color={torch ? '#facc15' : '#ffffff'}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.cameraTopIconButton}
                        onPress={() => setFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
                        accessibilityRole="button"
                        accessibilityLabel="Camera လှည့်ရန်"
                      >
                        <Ionicons name="camera-reverse-outline" size={22} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  ) : <View style={styles.cameraTopIconButton} />}
                </View>

                {modalError ? (
                  <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={18} color="#ef4444" />
                    <Text style={styles.errorBannerText}>{modalError}</Text>
                  </View>
                ) : null}

                <View style={styles.viewfinderCenterArea} pointerEvents="none" />

                <View style={styles.cameraBottomBar}>
                  <Text style={styles.cameraHintText}>
                    ပစ္စည်းပို့ဆောင်ပြီးစီးကြောင်း သက်သေဓာတ်ပုံ ရိုက်ပါ
                  </Text>
                  <View style={styles.shutterRow}>
                    <TouchableOpacity
                      style={[styles.webPickerButton, takingPhoto && styles.buttonDisabled]}
                      onPress={() => { void selectDeliveryPhoto(); }}
                      disabled={takingPhoto || submitting}
                      accessibilityRole="button"
                      accessibilityLabel="ဖုန်းထဲမှ သက်သေပုံ ရွေးမည်"
                    >
                      {takingPhoto ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Ionicons name="images-outline" size={24} color="#ffffff" />
                      )}
                      <Text style={styles.webPickerText}>ပုံရွေးမည်</Text>
                    </TouchableOpacity>
                    {Platform.OS !== 'web' && (
                      <TouchableOpacity
                        style={[styles.shutterOuter, takingPhoto && styles.buttonDisabled]}
                        onPress={() => { void takePhoto(); }}
                        disabled={takingPhoto}
                        accessibilityRole="button"
                        accessibilityLabel="ဓာတ်ပုံ ရိုက်မည်"
                      >
                        <View style={styles.shutterInner}>
                          {takingPhoto && <ActivityIndicator size="small" color="#0284c7" />}
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </SafeAreaView>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  titleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  count: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#ffedd5',
    color: '#c2410c',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffedd5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pendingButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ea580c',
    marginLeft: 4,
  },
  scanButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffedd5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0f172a',
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    padding: 12,
    paddingBottom: 120,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 120,
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  stateText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#ea580c',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    flexDirection: 'row',
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  image: {
    width: 92,
    height: 112,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  details: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  person: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    marginBottom: 2,
    fontSize: 11,
    color: '#64748b',
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 5,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#334155',
  },
  address: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#334155',
  },
  amounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 5,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  amountItem: {
    flex: 1,
    minWidth: 0,
  },
  amount: {
    fontSize: 11,
    color: '#334155',
  },
  total: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ea580c',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  statusInfo: {
    flex: 1,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ea580c',
  },
  deliverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#16a34a',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 7,
  },
  deliverButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  notice: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#f0fdf4',
    color: '#166534',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0f172a',
  },
  modalHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  modalHeaderTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalHeaderSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  closeIconButton: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  headerRightSpacer: {
    width: 38,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
  },
  previewImageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 16,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
  },
  viewfinderCenterArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinderFrame: {
    width: '82%',
    aspectRatio: 3 / 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 14,
    position: 'relative',
    borderStyle: 'dashed',
  },
  ratioBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratioBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  previewBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#0f172a',
  },
  retakeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 9,
    backgroundColor: '#f1f5f9',
  },
  retakeButtonText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmButton: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 9,
    backgroundColor: '#16a34a',
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  cameraContainer: {
    paddingBottom:50,
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera34Frame: {
    width: '100%',
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000000',
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  cameraTopIconButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  cameraTopInfo: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 10,
  },
  cameraTopTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  cameraTopSubtitle: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  cameraTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cameraBottomBar: {
    paddingHorizontal: 20,
    paddingBottom: 5,
    paddingTop: 16,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    alignItems: 'center',
  },
  cameraHintText: {
    color: '#ffffff',
    fontSize: 13,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    textAlign: 'center',
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
  },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webPickerButton: {
    position: 'absolute',
    left: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  webPickerText: {
    color: '#ffffff',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  errorBannerText: {
    flex: 1,
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
  },
  scannerHeader: {
    
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scannerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  scanFrame: {
    width: 260,
    height: 180,
    alignSelf: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 16,
  },
  scannerHint: {
    color: '#ffffff',
    fontSize: 14,
    textAlign: 'center',
  },
  scanResultContainer: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8fafc',
  },
  scanResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  scanResultTitle: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '700',
  },
  scanCode: {
    marginBottom: 12,
    color: '#334155',
    fontSize: 14,
    textAlign: 'center',
  },
  scanMatchContent: {
    paddingBottom: 24,
  },
});