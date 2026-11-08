import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageLoadingSkeleton } from '../components/page-loading-skeleton';
import { PullToRefreshControl } from '../components/pull-to-refresh-control';
import { supabase } from '../lib/supabase';
import { useAppTheme, useThemeStyles } from '../lib/theme-provider';

type Pickup = {
  id: string | number;
  sender_id: string | number;
  rider_id: string | number;
  status: string | null;
  note: string | null;
  created_at: string | null;
  sender: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
};

const PAGE_SIZE = 100;

function isAssignedStatus(status: string | null) {
  const normalizedStatus = status?.trim().toLocaleLowerCase();
  return normalizedStatus === 'assigned' || normalizedStatus === 'assgined';
}

export default function PickupsScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedPickup, setSelectedPickup] = useState<Pickup | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<{
    uri: string;
    base64: string;
    mimeType: 'image/jpeg' | 'image/png';
  } | null>(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState('');
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const assignedPickups = useMemo(
    () => pickups.filter((pickup) => isAssignedStatus(pickup.status)),
    [pickups],
  );
  const assignedPickupsCount = assignedPickups.length;

  const loadPickups = useCallback(async () => {
    try {
      setError('');
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
        setPickups([]);
        setError('ဤ email အတွက် rider profile မတွေ့ပါ။');
        return;
      }

      const allPickups: Omit<Pickup, 'sender'>[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: pickupsError } = await supabase
          .from('pickups')
          .select('id, sender_id, rider_id, status, note, created_at')
          .eq('rider_id', profile.rider_id)
          .in('status', ['Assigned', 'Assgined'])
          .order('created_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (pickupsError) throw pickupsError;

        const page = (data ?? []) as Omit<Pickup, 'sender'>[];
        allPickups.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const senderIds = [...new Set(allPickups.map((pickup) => String(pickup.sender_id)))];
      let senderById = new Map<string, Pickup['sender']>();
      if (senderIds.length > 0) {
        const { data: senders, error: sendersError } = await supabase
          .from('senders')
          .select('id, name, phone, "Address"')
          .in('id', senderIds);
        if (sendersError) throw sendersError;

        senderById = new Map(
          (senders ?? []).map((sender) => [
            String(sender.id),
            {
              name: sender.name,
              phone: sender.phone,
              address: sender.Address,
            },
          ]),
        );
      }

      setPickups(
        allPickups.map((pickup) => ({
          ...pickup,
          sender: senderById.get(String(pickup.sender_id)) ?? null,
        })),
      );
    } catch (loadError) {
      console.error('Could not load rider pickups:', loadError);
      setError('Pickup စာရင်းကို ရယူ၍မရပါ။ အင်တာနက် သို့မဟုတ် database ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPickups();
    }, [loadPickups]),
  );

  const openCompletion = async (pickup: Pickup) => {
    setCapturedPhoto(null);
    setCompletionError('');
    setNotice('');
    setFacing('back');
    setTorch(false);
    setSelectedPickup(pickup);
  };

  const takePhoto = async () => {
    if (takingPhoto) return;
    setTakingPhoto(true);
    setCompletionError('');

    try {
      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert(
          'Camera ခွင့်ပြုချက် လိုအပ်ပါသည်',
          'Pickup သက်သေဓာတ်ပုံ ရိုက်ရန် Camera ခွင့်ပြုချက်ပေးပါ။',
        );
        return;
      }
      if (!cameraRef.current) {
        setCompletionError('Camera ပြင်ဆင်နေပါသည်။ ခဏစောင့်ပြီး ထပ်နှိပ်ပါ။');
        return;
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });
      if (!photo?.uri) throw new Error('ဓာတ်ပုံရိုက်၍ မရပါ။');

      const uri = photo.uri;
      const base64 = (photo.base64 ?? '').replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      if (!base64) throw new Error('ဓာတ်ပုံ data ရယူ၍မရပါ။ ပြန်ရိုက်ပေးပါ။');
      setCapturedPhoto({ uri, base64, mimeType: 'image/jpeg' });
    } catch (photoError) {
      console.error('Could not capture pickup proof photo:', photoError);
      setCompletionError(photoError instanceof Error ? photoError.message : 'ဓာတ်ပုံရိုက်၍မရပါ။');
    } finally {
      setTakingPhoto(false);
    }
  };

  const selectPhoto = async () => {
    if (takingPhoto || updating) return;
    setTakingPhoto(true);
    setCompletionError('');

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('ရွေးထားသော ဓာတ်ပုံကို ဖတ်၍မရပါ။');

      const actions = asset.width > 1600 ? [{ resize: { width: 1600 } }] : [];
      const photo = await manipulateAsync(
        asset.uri,
        actions,
        { compress: 0.75, format: SaveFormat.JPEG, base64: true },
      );
      if (!photo.base64) throw new Error('ရွေးထားသော ဓာတ်ပုံ data ရယူ၍မရပါ။');
      if (photo.base64.length > 12_000_000) {
        throw new Error('ဓာတ်ပုံကို ပိုသေးအောင် ပြင်ဆင်ပြီး ပြန်ရွေးပါ။');
      }

      setCapturedPhoto({
        uri: photo.uri,
        base64: photo.base64,
        mimeType: 'image/jpeg',
      });
    } catch (photoError) {
      console.error('Could not select pickup proof photo:', photoError);
      setCompletionError(
        photoError instanceof Error ? photoError.message : 'ဓာတ်ပုံရွေး၍မရပါ။ ပြန်ကြိုးစားပါ။',
      );
    } finally {
      setTakingPhoto(false);
    }
  };

  const completePickup = async () => {
    if (!selectedPickup || !capturedPhoto?.base64 || updating) return;

    setUpdating(true);
    setCompletionError('');
    try {
      const { data, error: functionError } = await supabase.functions.invoke('complete-pickup-with-proof', {
        body: {
          pickupId: selectedPickup.id,
          proofBase64: capturedPhoto.base64,
          proofMimeType: capturedPhoto.mimeType,
        },
      });
      if (functionError) {
        let message = functionError.message;
        if (functionError.context instanceof Response) {
          const responseText = await functionError.context.clone().text();
          try {
            const responseBody: unknown = JSON.parse(responseText);
            if (
              typeof responseBody === 'object' &&
              responseBody !== null &&
              'error' in responseBody &&
              typeof responseBody.error === 'string'
            ) {
              message = responseBody.error;
            }
          } catch (parseError) {
            console.warn('Could not parse pickup proof function error response.', parseError);
            if (responseText.trim()) message = responseText.slice(0, 300);
          }
        }
        throw new Error(message);
      }
      if (data?.success !== true) throw new Error(data?.error || 'Pickup proof completion failed.');

      setPickups((current) => current.filter((pickup) => pickup.id !== selectedPickup.id));
      setSelectedPickup(null);
      setCapturedPhoto(null);
      setNotice('Pickup ကို Picked Up အဖြစ် မှတ်သားပြီး ဓာတ်ပုံကို Telegram သို့ ပို့ပြီးပါပြီ။');
    } catch (updateError) {
      console.error('Could not complete pickup with proof:', updateError);
      setCompletionError(
        updateError instanceof Error
          ? updateError.message
          : 'Pickup ကို သိမ်းဆည်း၍မရပါ။ Telegram channel, အင်တာနက်နှင့် Supabase function ကို စစ်ဆေးပါ။',
      );
    } finally {
      setUpdating(false);
    }
  };

  const renderPickup = (item: Pickup) => {
    return (
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <View style={styles.senderIcon}>
            <Ionicons name="person-outline" size={20} color="#f97316" />
          </View>
          <View style={styles.senderNameContainer}>
            <Text style={styles.senderName} numberOfLines={1}>{item.sender?.name || 'ပို့သူအမည် မရှိပါ'}</Text>
            <Text style={styles.status}>Assigned</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.senderDetails}
          onPress={() => router.push({
            pathname: '/(tabs)/map',
            params: { senderId: String(item.sender_id) },
          })}
          accessibilityRole="button"
          accessibilityLabel={`${item.sender?.name || 'ပို့သူ'} ၏ တည်နေရာကို မြေပုံပေါ်တွင် ပြရန်`}
        >
          <View style={styles.detailRow}>
            <Ionicons name="call-outline" size={16} color="#64748b" />
            <Text style={styles.detailText}>{item.sender?.phone || 'ဖုန်းနံပါတ် မရှိပါ'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={16} color="#64748b" />
            <Text style={styles.detailText} numberOfLines={2}>
              {item.sender?.address || 'လိပ်စာ မရှိပါ'} · မြေပုံတွင်ကြည့်ရန်
            </Text>
          </View>
        </TouchableOpacity>

        {item.note ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteLabel}>မှတ်ချက်</Text>
            <Text style={styles.noteText}>{item.note}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.completeButton}
          onPress={() => openCompletion(item)}
          accessibilityRole="button"
        >
          <Ionicons name="checkmark-done-outline" size={19} color="#fff" />
          <Text style={styles.completeButtonText}>Complete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="နောက်သို့"
        >
          <Ionicons name="arrow-back" size={23} color={isDark ? '#f1f5f9' : '#0f172a'} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Pickups</Text>
          <Text style={styles.subtitle}>သင်ကောက်ယူရမည့် ပစ္စည်းများ</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{assignedPickupsCount}</Text>
        </View>
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Ionicons name="checkmark-circle" size={18} color="#15803d" />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {!loading && !error ? (
        <TouchableOpacity
          style={styles.completedPickupButton}
          onPress={() => router.push('/completed-pickups')}
          accessibilityRole="button"
          accessibilityLabel="Picked Up Pickup များကို ကြည့်ရန်"
        >
          <View style={styles.completedPickupIcon}>
            <Ionicons name="checkmark-done-outline" size={21} color="#15803d" />
          </View>
          <View style={styles.completedPickupLabel}>
            <Text style={styles.completedPickupTitle}>Picked Up</Text>
            <Text style={styles.completedPickupSubtitle}>ပြီးစီးပြီး pickup များနှင့် ရက်စွဲစာရင်း</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#15803d" />
        </TouchableOpacity>
      ) : null}

      {loading ? (
        <PageLoadingSkeleton isDark={isDark} variant="pickup" />
      ) : error ? (
        <View style={styles.stateContainer}>
          <Ionicons name="alert-circle-outline" size={32} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => {
            setLoading(true);
            void loadPickups();
          }}>
            <Text style={styles.retryText}>ပြန်ကြိုးစားမည်</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={assignedPickups}
          renderItem={({ item }) => renderPickup(item)}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={assignedPickups.length ? styles.listContent : styles.emptyListContent}
          refreshControl={
            <PullToRefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadPickups();
              }}
              tintColor="#f97316"
              colors={['#f97316']}
            />
          }
          ListEmptyComponent={
            assignedPickups.length === 0 ? (
              <View style={styles.stateContainer}>
                <Ionicons name="cube-outline" size={36} color="#94a3b8" />
                <Text style={styles.stateText}>Assigned Pickup မရှိသေးပါ။</Text>
              </View>
            ) : undefined
          }
        />
      )}

      <Modal
        visible={selectedPickup !== null}
        animationType="slide"
        onRequestClose={() => {
          if (!updating) {
            setSelectedPickup(null);
            setCapturedPhoto(null);
            setCompletionError('');
          }
        }}
      >
        <SafeAreaView style={styles.proofContainer}>
          {capturedPhoto ? (
            <View style={styles.previewContainer}>
              <View style={styles.cameraTopBar}>
                <TouchableOpacity
                  style={styles.cameraTopIconButton}
                  onPress={() => {
                    if (!updating) {
                      setSelectedPickup(null);
                      setCapturedPhoto(null);
                      setCompletionError('');
                    }
                  }}
                  disabled={updating}
                  accessibilityRole="button"
                  accessibilityLabel="ပိတ်ရန်"
                >
                  <Ionicons name="close" size={26} color="#ffffff" />
                </TouchableOpacity>
                <View style={styles.cameraTopInfo}>
                  <Text style={styles.cameraTopTitle}>Pickup သက်သေပုံ အတည်ပြုရန်</Text>
                  <Text style={styles.cameraTopSubtitle} numberOfLines={1}>
                    {selectedPickup?.sender?.name || 'ပို့သူအမည် မရှိပါ'}
                  </Text>
                </View>
                <View style={styles.cameraTopIconButton} />
              </View>

              <View style={styles.previewImageWrapper}>
                <Image
                  source={{ uri: capturedPhoto.uri }}
                  style={styles.previewImage}
                  contentFit="contain"
                  accessibilityLabel="Pickup သက်သေဓာတ်ပုံ"
                />
              </View>

              {completionError ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={18} color="#ef4444" />
                  <Text style={styles.errorBannerText}>{completionError}</Text>
                </View>
              ) : null}

              <View style={styles.previewBottomBar}>
                <TouchableOpacity
                  style={[styles.retakeButton, updating && styles.buttonDisabled]}
                  onPress={() => {
                    setCapturedPhoto(null);
                    setCompletionError('');
                  }}
                  disabled={updating}
                  accessibilityRole="button"
                  accessibilityLabel="ပြန်ရိုက်မည်"
                >
                  <Ionicons name="refresh-outline" size={18} color="#0f172a" />
                  <Text style={styles.retakeButtonText}>ပြန်ရိုက်မည်</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.confirmButton, updating && styles.buttonDisabled]}
                  onPress={() => void completePickup()}
                  disabled={updating}
                  accessibilityRole="button"
                  accessibilityLabel="Pickup အတည်ပြုမည်"
                >
                  {updating ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="checkmark-circle-outline" size={19} color="#ffffff" />
                  )}
                  <Text style={styles.confirmText}>
                    {updating ? 'ပို့နေပါသည်...' : 'Pickup အတည်ပြုမည်'}
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
                    <Text style={styles.cameraHintText}>ဖုန်းထဲမှ Pickup သက်သေဓာတ်ပုံကို ရွေးပါ</Text>
                  </View>
                ) : !cameraPermission?.granted ? (
                  <View style={styles.viewfinderCenterArea}>
                    <Ionicons name="camera-outline" size={48} color="#cbd5e1" />
                    <Text style={styles.cameraHintText}>ကင်မရာရိုက်ရန် Camera ခွင့်ပြုပါ သို့မဟုတ် ဖုန်းထဲမှပုံရွေးပါ</Text>
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
                    onPress={() => {
                      if (!updating) {
                        setSelectedPickup(null);
                        setCapturedPhoto(null);
                        setCompletionError('');
                      }
                    }}
                    disabled={takingPhoto || updating}
                    accessibilityRole="button"
                    accessibilityLabel="ပိတ်ရန်"
                  >
                    <Ionicons name="close" size={26} color="#ffffff" />
                  </TouchableOpacity>

                  <View style={styles.cameraTopInfo}>
                    <Text style={styles.cameraTopTitle}>Pickup ဓာတ်ပုံရိုက်ပါ</Text>
                    {selectedPickup && (
                      <Text style={styles.cameraTopSubtitle} numberOfLines={1}>
                        Pickup #{selectedPickup.id} • {selectedPickup.sender?.name || '-'}
                      </Text>
                    )}
                  </View>

                  {Platform.OS !== 'web' ? (
                    <View style={styles.cameraTopActions}>
                      <TouchableOpacity
                        style={styles.cameraTopIconButton}
                        onPress={() => setTorch((previous) => !previous)}
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
                        onPress={() => setFacing((current) => current === 'back' ? 'front' : 'back')}
                        accessibilityRole="button"
                        accessibilityLabel="Camera လှည့်ရန်"
                      >
                        <Ionicons name="camera-reverse-outline" size={22} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  ) : <View style={styles.cameraTopIconButton} />}
                </View>

                {completionError ? (
                  <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={18} color="#ef4444" />
                    <Text style={styles.errorBannerText}>{completionError}</Text>
                  </View>
                ) : null}

                <View style={styles.viewfinderCenterArea} pointerEvents="none" />

                <View style={styles.cameraBottomBar}>
                  <Text style={styles.cameraHintText}>
                    Pickup လုပ်ပြီးကြောင်း သက်သေဓာတ်ပုံ ရိုက်ပါ
                  </Text>
                  <View style={styles.shutterRow}>
                    <TouchableOpacity
                      style={[styles.webPickerButton, (takingPhoto || updating) && styles.buttonDisabled]}
                      onPress={() => void selectPhoto()}
                      disabled={takingPhoto || updating}
                      accessibilityRole="button"
                      accessibilityLabel="ဖုန်းထဲမှ Pickup သက်သေပုံ ရွေးမည်"
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
                        style={[styles.shutterOuter, (takingPhoto || updating) && styles.buttonDisabled]}
                        onPress={() => void takePhoto()}
                        disabled={takingPhoto || updating}
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
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  headerText: { flex: 1, marginLeft: 12 },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 2, fontSize: 12, color: '#64748b' },
  countBadge: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffedd5',
  },
  countText: { color: '#c2410c', fontSize: 14, fontWeight: '800' },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  emptyListContent: { flexGrow: 1, justifyContent: 'center' },
  completedPickupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 2,
    padding: 12,
    gap: 11,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  completedPickupIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  completedPickupLabel: { flex: 1 },
  completedPickupTitle: { color: '#166534', fontSize: 14, fontWeight: '800' },
  completedPickupSubtitle: { color: '#15803d', fontSize: 11, marginTop: 3 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center' },
  senderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
  },
  senderNameContainer: { flex: 1, marginLeft: 11 },
  senderName: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  status: { color: '#c2410c', fontSize: 12, fontWeight: '700', marginTop: 4 },
  senderDetails: { marginTop: 14, gap: 9 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  detailText: { flex: 1, color: '#475569', fontSize: 13, lineHeight: 19 },
  noteBox: { marginTop: 12, padding: 11, borderRadius: 12, backgroundColor: '#f8fafc' },
  noteLabel: { color: '#64748b', fontSize: 11, fontWeight: '700', marginBottom: 3 },
  noteText: { color: '#334155', fontSize: 13, lineHeight: 18 },
  completeButton: {
    flexDirection: 'row',
    height: 46,
    marginTop: 16,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f97316',
  },
  completeButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  stateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 10 },
  errorText: { color: '#b91c1c', fontSize: 14, textAlign: 'center', marginTop: 10 },
  retryButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: '#f97316', marginTop: 14 },
  retryText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
  },
  noticeText: { flex: 1, color: '#166534', fontSize: 13, fontWeight: '600' },
  proofContainer: {
    flex: 1,
    backgroundColor: '#000000',
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
  cameraContainer: {
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
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
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
    textAlign: 'center',
  },
  cameraTopSubtitle: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  cameraTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewfinderCenterArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBottomBar: {
    paddingHorizontal: 20,
    paddingBottom: 5,
    paddingTop: 16,
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
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
  ratioBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  ratioBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
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
  errorBannerText: { flex: 1, color: '#991b1b', fontSize: 13, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
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
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f1f5f9',
  },
  retakeButtonText: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  confirmButton: {
    flex: 1.5,
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#f97316',
  },
  confirmText: { color: '#ffffff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
