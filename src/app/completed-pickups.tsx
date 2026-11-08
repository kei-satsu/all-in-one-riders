import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { SectionListRenderItem } from 'react-native';
import {
    SectionList,
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

type CompletedPickup = {
  id: string | number;
  sender_id: string | number;
  rider_id: string | number;
  status: string | null;
  note: string | null;
  quantity: number | null;
  created_at: string | null;
  sender: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
};

type CompletedPickupSection = {
  title: string;
  data: CompletedPickup[];
};

const PAGE_SIZE = 100;

function getDateKey(createdAt: string | null) {
  if (!createdAt) return 'undated';
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return 'undated';

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDate(dateKey: string) {
  if (dateKey === 'undated') return 'ရက်စွဲမရှိ';
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('my-MM', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function CompletedPickupsScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const [pickups, setPickups] = useState<CompletedPickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadCompletedPickups = useCallback(async () => {
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

      const allPickups: Omit<CompletedPickup, 'sender'>[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: pickupsError } = await supabase
          .from('pickups')
          .select('id, sender_id, rider_id, status, note, quantity, created_at')
          .eq('rider_id', profile.rider_id)
          .in('status', ['Picked Up', 'Completed'])
          .order('created_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (pickupsError) throw pickupsError;

        const page = (data ?? []) as Omit<CompletedPickup, 'sender'>[];
        allPickups.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const senderIds = [...new Set(allPickups.map((pickup) => String(pickup.sender_id)))];
      let senderById = new Map<string, CompletedPickup['sender']>();
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
      console.error('Could not load completed pickups:', loadError);
      setError('Completed Pickup စာရင်းကို ရယူ၍မရပါ။ အင်တာနက် သို့မဟုတ် database ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCompletedPickups();
    }, [loadCompletedPickups]),
  );

  const sections = useMemo<CompletedPickupSection[]>(() => {
    const groupedPickups = new Map<string, CompletedPickup[]>();
    for (const pickup of pickups) {
      const key = getDateKey(pickup.created_at);
      const group = groupedPickups.get(key);
      if (group) group.push(pickup);
      else groupedPickups.set(key, [pickup]);
    }

    return [...groupedPickups.entries()].map(([key, data]) => ({
      title: formatDate(key),
      data,
    }));
  }, [pickups]);

  const renderPickup: SectionListRenderItem<CompletedPickup, CompletedPickupSection> = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.senderIcon}>
          <Ionicons name="person-outline" size={20} color="#15803d" />
        </View>
        <View style={styles.senderNameContainer}>
          <Text style={styles.senderName} numberOfLines={1}>
            {item.sender?.name || 'ပို့သူအမည် မရှိပါ'}
          </Text>
          <Text style={styles.status}>
            Picked Up{item.quantity !== null ? ` · ${item.quantity} ခု` : ''}
          </Text>
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
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backButton, isDark && styles.darkBackButton]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="နောက်သို့"
        >
          <Ionicons name="arrow-back" size={23} color={isDark ? '#f1f5f9' : '#0f172a'} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Picked Up</Text>
          <Text style={styles.subtitle}>ကောက်ယူပြီးသော pickup များ</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{pickups.length}</Text>
        </View>
      </View>

      {loading ? (
        <PageLoadingSkeleton isDark={isDark} variant="pickup" />
      ) : error ? (
        <View style={styles.stateContainer}>
          <Ionicons name="alert-circle-outline" size={32} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              void loadCompletedPickups();
            }}
          >
            <Text style={styles.retryText}>ပြန်ကြိုးစားမည်</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderPickup}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={pickups.length ? styles.listContent : styles.emptyListContent}
          renderSectionHeader={({ section }: { section: CompletedPickupSection }) => (
            <View style={styles.dateHeader}>
              <View style={styles.dateIcon}>
                <Ionicons name="calendar-outline" size={16} color="#15803d" />
              </View>
              <Text style={styles.dateTitle}>{section.title}</Text>
              <View style={styles.dateCountBadge}>
                <Text style={styles.dateCount}>{section.data.length}</Text>
              </View>
            </View>
          )}
          refreshControl={
            <PullToRefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadCompletedPickups();
              }}
              tintColor="#16a34a"
              colors={['#16a34a']}
            />
          }
          ListEmptyComponent={
            <View style={styles.stateContainer}>
              <Ionicons name="checkmark-done-circle-outline" size={38} color="#94a3b8" />
              <Text style={styles.stateText}>Picked Up pickup မရှိသေးပါ။</Text>
            </View>
          }
        />
      )}
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
  darkBackButton: { backgroundColor: '#202b3d' },
  headerText: { flex: 1, marginLeft: 12 },
  title: { color: '#0f172a', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#64748b', fontSize: 12, marginTop: 2 },
  countBadge: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  countText: { color: '#15803d', fontSize: 14, fontWeight: '800' },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  emptyListContent: { flexGrow: 1, justifyContent: 'center' },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 12,
    paddingBottom: 11,
  },
  dateIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  dateTitle: { flex: 1, color: '#334155', fontSize: 14, fontWeight: '800' },
  dateCountBadge: {
    minWidth: 25,
    height: 25,
    paddingHorizontal: 7,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  dateCount: { color: '#475569', fontSize: 11, fontWeight: '700' },
  card: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  senderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
  },
  senderNameContainer: { flex: 1, marginLeft: 11 },
  senderName: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
  status: { color: '#15803d', fontSize: 12, fontWeight: '700', marginTop: 4 },
  senderDetails: { marginTop: 14, gap: 9 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  detailText: { flex: 1, color: '#475569', fontSize: 13, lineHeight: 19 },
  noteBox: { marginTop: 12, padding: 11, borderRadius: 12, backgroundColor: '#f8fafc' },
  noteLabel: { color: '#64748b', fontSize: 11, fontWeight: '700', marginBottom: 3 },
  noteText: { color: '#334155', fontSize: 13, lineHeight: 18 },
  stateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 10 },
  errorText: { color: '#b91c1c', fontSize: 14, textAlign: 'center', marginTop: 10 },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#16a34a',
    marginTop: 14,
  },
  retryText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
