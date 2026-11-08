import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ParcelCard, type ParcelCardData } from '../components/parcel-card';
import { PageLoadingSkeleton } from '../components/page-loading-skeleton';
import { PullToRefreshControl } from '../components/pull-to-refresh-control';
import { getCurrentDateInterval } from '../lib/date-range';
import { supabase } from '../lib/supabase';
import { useAppTheme, useThemeStyles } from '../lib/theme-provider';

type PickupWay = ParcelCardData & {
  received_date: string | null;
};

type DateField = 'from' | 'to';

const PAGE_SIZE = 100;
const WEEKDAYS = ['တနင်္ဂနွေ', 'တနင်္လာ', 'အင်္ဂါ', 'ဗုဒ္ဓဟူး', 'ကြာသပတေး', 'သောကြာ', 'စနေ'];

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PickupWaysScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const today = useMemo(() => new Date(), []);
  const defaultDateInterval = useMemo(() => getCurrentDateInterval(today), [today]);
  const [fromDate, setFromDate] = useState(defaultDateInterval.fromDate);
  const [toDate, setToDate] = useState(defaultDateInterval.toDate);
  const [ways, setWays] = useState<PickupWay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [calendarField, setCalendarField] = useState<DateField | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => parseDateKey(defaultDateInterval.fromDate));

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
        setError('ဤ email အတွက် rider profile မတွေ့ပါ။');
        return;
      }

      const allWays: PickupWay[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: queryError } = await supabase
          .from('orders')
          .select('id, item_id, barcode, sender_name, receiver_name, receiver_phone, receiver_address, cod_amount, deli_fee, total_amount, image_url, received_date')
          .eq('pickup_rider_id', profile.rider_id)
          .eq('status', 'Settled')
          .eq('is_deleted', false)
          .gte('received_date', fromDate)
          .lte('received_date', toDate)
          .order('received_date', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (queryError) throw queryError;

        const page = (data ?? []) as PickupWay[];
        allWays.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      setWays(allWays);
      setError('');
    } catch {
      setError('Pickup Ways စာရင်းရယူ၍မရပါ။ received_date column၊ အင်တာနက် သို့မဟုတ် database ခွင့်ပြုချက်ကို စစ်ဆေးပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(
    useCallback(() => {
      void loadWays();
    }, [loadWays]),
  );

  const selectedDate = calendarField === 'from' ? fromDate : toDate;
  const selectedDateValue = selectedDate ? parseDateKey(selectedDate) : today;
  const calendarStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const dayCount = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells: (Date | null)[] = [
    ...Array.from({ length: calendarStart.getDay() }, () => null),
    ...Array.from({ length: dayCount }, (_, index) =>
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index + 1),
    ),
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);
  const monthLabel = calendarMonth.toLocaleDateString('my-MM', { month: 'long', year: 'numeric' });

  const selectDate = (date: Date) => {
    const value = dateKey(date);
    if (calendarField === 'from') {
      setFromDate(value);
      if (value > toDate) setToDate(value);
    } else if (calendarField === 'to') {
      setToDate(value);
      if (value < fromDate) setFromDate(value);
    }
    setCalendarField(null);
  };

  const renderWay = ({ item }: { item: PickupWay }) => (
    <ParcelCard parcel={item} date={item.received_date} />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="နောက်သို့"
        >
          <Ionicons name="arrow-back" size={24} color={isDark ? '#f1f5f9' : '#0f172a'} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pickup Ways</Text>
      </View>

      <View style={styles.filtersCard}>
        <View style={styles.filterHeader}>
          <View style={styles.filterIcon}>
            <Ionicons name="calendar-outline" size={19} color="#c2410c" />
          </View>
          <View>
            <Text style={styles.filterTitle}>လက်ခံရက်အလိုက် ကြည့်ရန်</Text>
            <Text style={styles.filterSubtitle}>From / To ရက်စွဲကို ရွေးပါ</Text>
          </View>
        </View>
        <View style={styles.dateFields}>
          <TouchableOpacity
            style={styles.dateField}
            onPress={() => {
              setCalendarMonth(parseDateKey(fromDate));
              setCalendarField('from');
            }}
            accessibilityRole="button"
            accessibilityLabel={`From ${formatDate(parseDateKey(fromDate))}`}
          >
            <Text style={styles.dateLabel}>FROM</Text>
            <View style={styles.dateValueRow}>
              <Ionicons name="calendar" size={16} color="#f97316" />
              <Text style={styles.dateValue}>{formatDate(parseDateKey(fromDate))}</Text>
            </View>
          </TouchableOpacity>
          <Ionicons name="arrow-forward" size={17} color="#94a3b8" />
          <TouchableOpacity
            style={styles.dateField}
            onPress={() => {
              setCalendarMonth(parseDateKey(toDate));
              setCalendarField('to');
            }}
            accessibilityRole="button"
            accessibilityLabel={`To ${formatDate(parseDateKey(toDate))}`}
          >
            <Text style={styles.dateLabel}>TO</Text>
            <View style={styles.dateValueRow}>
              <Ionicons name="calendar" size={16} color="#f97316" />
              <Text style={styles.dateValue}>{formatDate(parseDateKey(toDate))}</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.resultSummary}>
          <View style={styles.resultIcon}>
            <Ionicons name="cube-outline" size={20} color="#15803d" />
          </View>
          <Text style={styles.resultLabel}>ရွေးထားသောကာလအတွင်း</Text>
          <Text style={styles.resultCount}>{loading ? '…' : ways.length}</Text>
          <Text style={styles.resultUnit}>ပါဆယ်</Text>
        </View>
      </View>

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
          data={ways}
          renderItem={renderWay}
          keyExtractor={(item) => String(item.id)}
          initialNumToRender={3}
          maxToRenderPerBatch={4}
          windowSize={5}
          contentContainerStyle={ways.length ? styles.content : styles.emptyContent}
          refreshControl={
            <PullToRefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void loadWays(); }}
              tintColor="#f97316"
            />
          }
          ListEmptyComponent={<Text style={styles.stateText}>ရွေးထားသောရက်စွဲအတွင်း Pickup way မရှိပါ။</Text>}
        />
      )}

      <Modal
        visible={calendarField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarField(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity
                style={styles.monthButton}
                onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                accessibilityRole="button"
                accessibilityLabel="ယခင်လ"
              >
                <Ionicons name="chevron-back" size={22} color="#334155" />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>{monthLabel}</Text>
              <TouchableOpacity
                style={styles.monthButton}
                onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                accessibilityRole="button"
                accessibilityLabel="နောက်လ"
              >
                <Ionicons name="chevron-forward" size={22} color="#334155" />
              </TouchableOpacity>
            </View>
            <View style={styles.weekRow}>
              {WEEKDAYS.map((weekday) => (
                <Text key={weekday} style={styles.weekday}>{weekday.slice(0, 1)}</Text>
              ))}
            </View>
            {Array.from({ length: calendarCells.length / 7 }, (_, row) => (
              <View key={row} style={styles.weekRow}>
                {calendarCells.slice(row * 7, row * 7 + 7).map((date, column) => {
                  const isSelected = date !== null && dateKey(date) === dateKey(selectedDateValue);
                  return (
                    <TouchableOpacity
                      key={date ? dateKey(date) : `blank-${row}-${column}`}
                      style={[styles.dayCell, isSelected && styles.selectedDayCell]}
                      disabled={date === null}
                      onPress={() => { if (date) selectDate(date); }}
                      accessibilityRole={date ? 'button' : undefined}
                      accessibilityLabel={date ? formatDate(date) : undefined}
                    >
                      {date && <Text style={[styles.dayText, isSelected && styles.selectedDayText]}>{date.getDate()}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setCalendarField(null)}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>ပိတ်မည်</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backButton: { marginRight: 12, padding: 4 },
  headerTitle: { flex: 1, color: '#0f172a', fontSize: 19, fontWeight: '700' },
  filtersCard: { margin: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#ffedd5', backgroundColor: '#ffffff' },
  filterHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  filterIcon: { width: 36, height: 36, marginRight: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#ffedd5' },
  filterTitle: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  filterSubtitle: { marginTop: 2, color: '#64748b', fontSize: 11 },
  dateFields: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateField: { flex: 1, minWidth: 0, padding: 10, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 9, backgroundColor: '#f8fafc' },
  dateLabel: { marginBottom: 5, color: '#64748b', fontSize: 10, fontWeight: '700' },
  dateValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateValue: { flexShrink: 1, color: '#0f172a', fontSize: 12, fontWeight: '600' },
  resultSummary: { flexDirection: 'row', alignItems: 'center', marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  resultIcon: { width: 34, height: 34, marginRight: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#dcfce7' },
  resultLabel: { flex: 1, color: '#475569', fontSize: 12 },
  resultCount: { color: '#15803d', fontSize: 23, fontWeight: '800' },
  resultUnit: { marginLeft: 5, color: '#64748b', fontSize: 12 },
  content: { paddingHorizontal: 12, paddingBottom: 24 },
  emptyContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  stateText: { marginTop: 12, color: '#64748b', fontSize: 14, textAlign: 'center' },
  retryButton: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f97316' },
  retryText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0f172a88' },
  calendarCard: { padding: 16, borderRadius: 18, backgroundColor: '#ffffff', elevation: 8 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#f1f5f9' },
  monthTitle: { color: '#0f172a', fontSize: 17, fontWeight: '700' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-around' },
  weekday: { width: '13%', paddingVertical: 8, color: '#64748b', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  dayCell: { width: '13%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  selectedDayCell: { backgroundColor: '#f97316' },
  dayText: { color: '#334155', fontSize: 14 },
  selectedDayText: { color: '#ffffff', fontWeight: '700' },
  cancelButton: { alignSelf: 'flex-end', marginTop: 12, paddingHorizontal: 14, paddingVertical: 9 },
  cancelText: { color: '#f97316', fontSize: 14, fontWeight: '700' },
});