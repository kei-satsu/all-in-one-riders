import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
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
import { updateOrderStatus } from '../../lib/update-order-status';

type DeliveredWay = ParcelCardData;

const PAGE_SIZE = 100;

function formatAmount(amount: number | string | null) {
  if (amount == null || amount === '') return '-';
  const value = Number(amount);
  return Number.isNaN(value) ? `${amount} ကျပ်` : `${value.toLocaleString()} ကျပ်`;
}

export default function DeliveredScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const [ways, setWays] = useState<DeliveredWay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [riderId, setRiderId] = useState<string | number | null>(null);
  const [updatingWayId, setUpdatingWayId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

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

      const allWays: DeliveredWay[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: queryError } = await supabase
          .from('orders')
          .select('id, item_id, barcode, sender_name, receiver_name, receiver_phone, receiver_address, cod_amount, deli_fee, total_amount, image_url')
          .eq('deliver_rider_id', profile.rider_id)
          .eq('status', 'Delivered')
          .eq('is_deleted', false)
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (queryError) throw queryError;

        const page = (data ?? []) as DeliveredWay[];
        allWays.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      setWays(allWays);
      setError('');
    } catch {
      setError('Delivered ပါဆယ်စာရင်းကို ရယူ၍မရပါ။ အင်တာနက် သို့မဟုတ် database ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const markUndelivered = useCallback(async (way: DeliveredWay) => {
    if (!riderId || updatingWayId) return;

    setUpdatingWayId(String(way.id));
    setNotice('');
    try {
      await updateOrderStatus({
        orderId: way.id,
        riderId,
        currentStatus: 'Delivered',
        nextStatus: 'On Way',
      });

      setWays((current) => current.filter((item) => item.id !== way.id));
      setNotice('ပါဆယ်၏ Status ကို On Way သို့ ပြန်ပြောင်းပြီးပါပြီ။');
    } catch {
      setNotice('On Way သို့ ပြန်ပြောင်း၍မရပါ။ အော်ဒါအခြေအနေ သို့မဟုတ် အင်တာနက်ကို စစ်ဆေးပါ။');
    } finally {
      setUpdatingWayId(null);
    }
  }, [riderId, updatingWayId]);

  useFocusEffect(
    useCallback(() => {
      void loadWays();
    }, [loadWays]),
  );

  const totalAmount = useMemo(() => ways.reduce((total, way) => {
    const amount = Number(way.total_amount);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0), [ways]);

  const filteredWays = ways.filter((way) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [
      way.id,
      way.item_id,
      way.barcode,
      way.sender_name,
      way.receiver_name,
      way.receiver_phone,
      way.receiver_address,
    ].some((value) => value != null && String(value).toLowerCase().includes(query));
  });

  const renderWay = ({ item }: { item: DeliveredWay }) => (
    <ParcelCard
      parcel={item}
      action={
        <TouchableOpacity
          style={[styles.undeliveredButton, updatingWayId !== null && styles.buttonDisabled]}
          onPress={() => { void markUndelivered(item); }}
          disabled={updatingWayId !== null}
          accessibilityRole="button"
          accessibilityLabel="Delivered မဟုတ်တော့ပါ၊ On Way ပြန်ပြောင်းရန်"
        >
          {updatingWayId === String(item.id) ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="return-up-back-outline" size={17} color="#ffffff" />
          )}
          <Text style={styles.buttonText}>Undo Delivered</Text>
        </TouchableOpacity>
      }
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>Delivered Ways</Text>
          {!loading && <Text style={styles.count}>{ways.length}</Text>}
        </View>
      </View>
      {!loading && !error && (
        <View style={styles.summary}>
          <View style={styles.summaryIcon}>
            <Ionicons name="cash-outline" size={22} color="#15803d" />
          </View>
          <View style={styles.summaryDetails}>
            <Text style={styles.summaryLabel}>Total Amount</Text>
            <Text style={styles.summaryAmount}>{formatAmount(totalAmount)}</Text>
          </View>
        </View>
      )}
      {!loading && !error && (
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={19} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="ID၊ barcode၊ အမည်၊ ဖုန်းနံပါတ်ဖြင့် ရှာရန်"
            placeholderTextColor="#94a3b8"
            returnKeyType="search"
            accessibilityLabel="Delivered ပါဆယ်ရှာရန်"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="ရှာဖွေမှုဖျက်ရန်">
              <Ionicons name="close-circle" size={20} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
      )}
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
          ListEmptyComponent={<Text style={styles.stateText}>{ways.length ? 'ရှာဖွေမှုနှင့် ကိုက်ညီသော way မရှိပါ။' : 'Delivered ဖြစ်နေသော ပါဆယ်မရှိပါ။'}</Text>}
        />
      )}
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
    backgroundColor: '#dcfce7',
    color: '#15803d',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
  },
  summaryIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#dcfce7',
  },
  summaryDetails: {
    flex: 1,
    marginLeft: 12,
  },
  summaryLabel: {
    color: '#475569',
    fontSize: 12,
  },
  summaryAmount: {
    marginTop: 3,
    color: '#15803d',
    fontSize: 20,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 12,
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 9,
    fontSize: 14,
    color: '#0f172a',
  },
  notice: {
    marginHorizontal: 16,
    marginTop: 8,
    color: '#c2410c',
    fontSize: 13,
    textAlign: 'center',
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
    backgroundColor: '#f97316',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  undeliveredButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#f97316',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
