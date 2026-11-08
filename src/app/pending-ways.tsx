import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router } from 'expo-router';
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
import { ParcelCard, type ParcelCardData } from '../components/parcel-card';
import { PageLoadingSkeleton } from '../components/page-loading-skeleton';
import { PullToRefreshControl } from '../components/pull-to-refresh-control';
import { supabase } from '../lib/supabase';
import { useAppTheme, useThemeStyles } from '../lib/theme-provider';

type HandoverOrder = ParcelCardData;

const PAGE_SIZE = 100;

function formatAmount(amount: number | string | null) {
  if (amount == null || amount === '') return '-';
  const value = Number(amount);
  return Number.isNaN(value) ? `${amount} ကျပ်` : `${value.toLocaleString()} ကျပ်`;
}

export default function PendingWaysScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const [orders, setOrders] = useState<HandoverOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [riderId, setRiderId] = useState<string | number | null>(null);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const [notice, setNotice] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scannedOrder, setScannedOrder] = useState<HandoverOrder | null>(null);
  const [scanLookupLoading, setScanLookupLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLocked = useRef(false);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((item) =>
      [
        item.id,
        item.receiver_name,
        item.receiver_phone,
        item.receiver_address,
        item.sender_name,
      ].some((field) => field != null && String(field).toLowerCase().includes(q))
    );
  }, [orders, search]);

  const loadOrders = useCallback(async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      setError('');

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
        setOrders([]);
        setRiderId(null);
        setError('ဤ email အတွက် rider profile မတွေ့ပါ။');
        return;
      }
      setRiderId(profile.rider_id);

      const allOrders: HandoverOrder[] = [];

      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: ordersError } = await supabase
          .from('orders')
          .select('id, item_id, barcode, sender_name, receiver_name, receiver_phone, receiver_address, cod_amount, deli_fee, total_amount, image_url')
          .eq('deliver_rider_id', profile.rider_id)
          .eq('status', 'Handover')
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (ordersError) throw ordersError;

        const page = (data ?? []) as HandoverOrder[];
        allOrders.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      setOrders(allOrders);
    } catch {
      setError('အော်ဒါများ ရယူ၍မရပါ။ အင်တာနက်ကိုစစ်ပြီး ပြန်ကြိုးစားပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const acceptOrder = useCallback(async (order: HandoverOrder) => {
    if (!riderId || acceptingOrderId || acceptingAll) return;

    setAcceptingOrderId(String(order.id));
    setNotice('');
    try {
      const { data, error: updateError } = await supabase
        .from('orders')
        .update({ status: 'On Way' })
        .eq('id', order.id)
        .eq('deliver_rider_id', riderId)
        .eq('status', 'Handover')
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!data) throw new Error('Order is no longer available for acceptance.');

      setOrders((current) => current.filter((item) => item.id !== order.id));
      setNotice('လမ်းကြောင်းကို လက်ခံပြီး On Way သို့ ပြောင်းပြီးပါပြီ။');
      setScanResult(null);
      setScannedOrder(null);
    } catch {
      setNotice('လက်ခံ၍မရပါ။ အော်ဒါအခြေအနေ သို့မဟုတ် အင်တာနက်ကို စစ်ဆေးပါ။');
    } finally {
      setAcceptingOrderId(null);
    }
  }, [acceptingAll, acceptingOrderId, riderId]);

  const acceptAllOrders = useCallback(() => {
    if (!riderId || acceptingAll || acceptingOrderId || orders.length === 0) return;

    const acceptAll = async () => {
      setAcceptingAll(true);
      setNotice('');
      try {
        const { data, error: updateError } = await supabase
          .from('orders')
          .update({ status: 'On Way' })
          .eq('deliver_rider_id', riderId)
          .eq('status', 'Handover')
          .select('id');

        if (updateError) throw updateError;

        const count = data?.length ?? 0;
        setOrders([]);
        setScanResult(null);
        setScannedOrder(null);
        setNotice(`Way စုစုပေါင်း ${count} ခုလုံးကို အောင်မြင်စွာ လက်ခံပြီး On Way သို့ ပြောင်းပြီးပါပြီ။`);
      } catch {
        const message = 'အားလုံး လက်ခံ၍မရပါ။ အင်တာနက် သို့မဟုတ် အော်ဒါအခြေအနေကို စစ်ဆေးပါ။';
        if (Platform.OS === 'web') {
          window.alert(message);
        } else {
          Alert.alert('အမှား', message);
        }
      } finally {
        setAcceptingAll(false);
      }
    };

    const title = 'အားလုံးကို လက်ခံမည်လား?';
    const message = `လက်ရှိ Handover ဖြစ်နေသော Way စုစုပေါင်း (${orders.length}) ခုလုံးကို On Way အဖြစ် လက်ခံဆောင်ရွက်ပါမည်။`;
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) void acceptAll();
      return;
    }

    Alert.alert(title, message, [
      { text: 'မလုပ်ပါ', style: 'cancel' },
      { text: 'အားလုံးလက်ခံမည်', onPress: () => { void acceptAll(); } },
    ]);
  }, [acceptingAll, acceptingOrderId, orders.length, riderId]);

  const handleBarcodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    if (scanLocked.current || !riderId) return;

    const value = data.trim();
    if (!value) return;

    scanLocked.current = true;
    setScannerVisible(false);
    setScanResult(value);
    setScannedOrder(null);
    setScanMessage('');
    setScanLookupLoading(true);

    try {
      const columns = 'id, item_id, barcode, sender_name, receiver_name, receiver_phone, receiver_address, cod_amount, deli_fee, total_amount, image_url';
      const lookup = async (column: 'item_id' | 'barcode') => {
        const { data: order, error: lookupError } = await supabase
          .from('orders')
          .select(columns)
          .eq('deliver_rider_id', riderId)
          .eq('status', 'Handover')
          .eq(column, value)
          .limit(1)
          .maybeSingle();
        if (lookupError) throw lookupError;
        return order as HandoverOrder | null;
      };

      const order = await lookup('item_id') ?? await lookup('barcode');
      if (!order) {
        setScanMessage('ဒီ item_id သို့မဟုတ် barcode နဲ့ကိုက်တဲ့ Handover way မတွေ့ပါ။');
        return;
      }

      setScannedOrder(order);
    } catch {
      setScanMessage('Scan result ကိုရှာမရပါ။ item_id/barcode column နဲ့ database ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    } finally {
      setScanLookupLoading(false);
      scanLocked.current = false;
    }
  }, [riderId]);

  const openScanner = useCallback(async () => {
    setNotice('');
    setScanResult(null);
    setScannedOrder(null);
    setScanMessage('');

    try {
      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission();
      if (!permission.granted) {
        setNotice('QR/Barcode ဖတ်ရန် Camera ခွင့်ပြုချက် လိုအပ်ပါသည်။');
        return;
      }
      setScannerVisible(true);
    } catch {
      setNotice('Camera ကိုဖွင့်၍မရပါ။ ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    }
  }, [cameraPermission, requestCameraPermission]);

  const closeScanner = useCallback(() => {
    setScannerVisible(false);
    setScanResult(null);
    setScannedOrder(null);
    setScanMessage('');
    setScanLookupLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadOrders();
    });
    return () => {
      active = false;
    };
  }, [loadOrders]);

  const renderOrder = ({ item }: { item: HandoverOrder }) => (
    <ParcelCard
      parcel={item}
      action={
        <TouchableOpacity
          style={[styles.acceptButton, acceptingOrderId === String(item.id) && styles.acceptButtonDisabled]}
          onPress={() => { void acceptOrder(item); }}
          disabled={acceptingOrderId !== null}
          accessibilityRole="button"
          accessibilityLabel="Accept way"
        >
          {acceptingOrderId === String(item.id) ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="checkmark-circle-outline" size={17} color="#ffffff" />
          )}
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      }
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="နောက်သို့">
          <Ionicons name="arrow-back" size={24} color="#e93f15" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Handover Ways</Text>
        {!loading && <Text style={styles.count}>{orders.length}</Text>}
        {orders.length > 0 && (
          <TouchableOpacity
            style={[styles.acceptAllButton, (acceptingAll || loading) && styles.buttonDisabled]}
            onPress={acceptAllOrders}
            disabled={acceptingAll || loading}
            accessibilityRole="button"
            accessibilityLabel="Way အားလုံးကို လက်ခံရန်"
          >
            {acceptingAll ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons name="checkmark-done" size={17} color="#ffffff" />
            )}
            <Text style={styles.acceptAllText}>
              {acceptingAll ? 'လက်ခံနေပါသည်...' : 'Accept All'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => { void openScanner(); }}
          disabled={loading || !riderId || acceptingAll}
          accessibilityRole="button"
          accessibilityLabel="QR သို့ Barcode scan ဖတ်ရန်"
        >
          <Ionicons name="scan-outline" size={21} color="#f97316" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={19} color={isDark ? '#94a3b8' : '#64748b'} />
        <TextInput
          style={styles.searchInput}
          placeholder="Way ID, အမည်, ဖုန်း, လိပ်စာဖြင့် ရှာရန်..."
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
          <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); void loadOrders(); }}>
            <Text style={styles.retryText}>ပြန်ကြိုးစားမည်</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={filteredOrders}
          renderItem={renderOrder}
          keyExtractor={(item) => String(item.id)}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          windowSize={5}
          contentContainerStyle={filteredOrders.length ? styles.listContent : styles.emptyContent}
          refreshControl={
            <PullToRefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void loadOrders(); }}
              tintColor="#f97316"
            />
          }
          ListEmptyComponent={
            <Text style={styles.stateText}>
              {search.trim() ? 'ရှာဖွေမှုနှင့် ကိုက်ညီသော Handover way မတွေ့ပါ။' : 'Handover ဖြစ်နေသော way မရှိသေးပါ။'}
            </Text>
          }
        />
      )}
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
                barcodeTypes: ['qr', 'code128', 'code39', 'code93', 'ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'codabar', 'pdf417', 'aztec', 'datamatrix'],
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
            <Text style={styles.scanCode} numberOfLines={3}>{scanResult}</Text>
            {scanLookupLoading ? (
              <View style={styles.stateContainer}>
                <ActivityIndicator size="large" color="#0284c7" />
                <Text style={styles.stateText}>Handover way ကိုရှာနေပါသည်...</Text>
              </View>
            ) : scannedOrder ? (
              <FlatList
                data={[scannedOrder]}
                renderItem={renderOrder}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
    flex: 1,
  },
  scanButton: {
    width: 38,
    height: 38,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#ffedd5',
  },
  acceptAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#ea580c',
  },
  acceptAllText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  notice: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#fff7ed',
    color: '#c2410c',
    fontSize: 13,
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
  listContent: {
    padding: 12,
    paddingBottom: 24,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
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
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    marginTop: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 7,
    backgroundColor: '#ea580c',
  },
  acceptButtonDisabled: {
    opacity: 0.7,
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
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
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  scannerHeader: {
    paddingTop:40,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scannerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  scanFrame: {
    width: '78%',
    aspectRatio: 1,
    maxWidth: 300,
    maxHeight: 300,
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 16,
  },
  scannerHint: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#00000099',
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 14,
  },
  scanResultContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scanResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  scanResultTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
  },
  scanCode: {
    margin: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    color: '#334155',
    fontSize: 13,
  },
  scanMatchContent: {
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
});