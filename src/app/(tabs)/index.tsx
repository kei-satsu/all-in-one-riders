import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PullToRefreshControl } from '../../components/pull-to-refresh-control';
import { startBroadcastingLocation } from '../../lib/location-broadcast';
import { supabase } from '../../lib/supabase';
import { useAppTheme, useThemeStyles } from '../../lib/theme-provider';

const DASHBOARD_LOAD_TIMEOUT_MS = 15_000;

function HomeLoadingSkeleton({ isDark }: { isDark: boolean }) {
  const styles = baseStyles;
  const shimmer = useSharedValue(0.35);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  const surface = isDark ? '#151c2a' : '#ffffff';
  const placeholderColor = isDark ? '#293447' : '#e9eef5';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';

  React.useEffect(() => () => cancelAnimation(shimmer), [shimmer]);

  const startShimmer = () => {
    // Reanimated shared values need a direct assignment to start UI-thread animations.
    // eslint-disable-next-line react-hooks/immutability
    shimmer.value = withRepeat(withTiming(0.9, { duration: 850 }), -1, true);
  };

  const block = (width: number | `${number}%`, height: number, borderRadius = 8) =>
    React.createElement(Animated.View, {
      style: [{ width, height, borderRadius, backgroundColor: placeholderColor }, shimmerStyle],
    });

  return React.createElement(
    SafeAreaView,
    { style: [styles.loadingContainer, { backgroundColor: isDark ? '#0b1220' : '#f8fafc' }] },
    React.createElement(
      View,
      { style: styles.loadingContent, onLayout: startShimmer },
      React.createElement(
        View,
        { style: [styles.loadingHeader, { backgroundColor: surface }] },
        React.createElement(View, { style: [styles.loadingLogo, { backgroundColor: placeholderColor }] }),
        React.createElement(
          View,
          { style: styles.loadingHeaderText },
          block(92, 12),
          block('76%', 17),
          block('54%', 12),
        ),
      ),
      React.createElement(
        View,
        { style: styles.loadingStats },
        [0, 1].map((item) =>
          React.createElement(
            View,
            { key: item, style: [styles.loadingStatCard, { backgroundColor: surface }] },
            block(84, 12),
            block('65%', 24),
            block(52, 11),
          ),
        ),
      ),
      React.createElement(
        View,
        { style: [styles.loadingPickupCard, { backgroundColor: surface }] },
        React.createElement(View, { style: [styles.loadingIcon, { backgroundColor: placeholderColor }] }),
        React.createElement(
          View,
          { style: styles.loadingPickupText },
          block('78%', 14),
          block('92%', 11),
        ),
        block(28, 24, 12),
      ),
      React.createElement(
        View,
        { style: [styles.loadingQuickAction, { backgroundColor: isDark ? '#7c2d12' : '#f97316' }] },
        React.createElement(View, { style: [styles.loadingIcon, { backgroundColor: 'rgba(255,255,255,0.22)' }] }),
        React.createElement(
          View,
          { style: styles.loadingPickupText },
          React.createElement(View, { style: [styles.loadingLine, { width: '60%', backgroundColor: 'rgba(255,255,255,0.65)' }] }),
          React.createElement(View, { style: [styles.loadingLine, { width: '90%', backgroundColor: 'rgba(255,255,255,0.32)' }] }),
        ),
      ),
      React.createElement(
        View,
        { style: [styles.loadingMenu, { backgroundColor: surface }] },
        [0, 1, 2].map((item) =>
          React.createElement(
            View,
            { key: item, style: [styles.loadingMenuRow, item > 0 && { borderTopWidth: 1, borderTopColor: placeholderColor }] },
            React.createElement(View, { style: [styles.loadingMenuIcon, { backgroundColor: placeholderColor }] }),
            React.createElement(
              View,
              { style: styles.loadingPickupText },
              block('44%', 12),
              block('72%', 10),
            ),
          ),
        ),
      ),
      React.createElement(Text, { style: [styles.loadingText, { color: mutedColor }] }, 'အချက်အလက်များ ပြင်ဆင်နေပါသည်...'),
    ),
  );
}

export default function HomeScreen() {
  const { isDark } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [riderName, setRiderName] = useState('');
  const [riderId, setRiderId] = useState<string | number | null>(null);
  const [isOnDuty, setIsOnDuty] = useState(false);
  const [dutySaving, setDutySaving] = useState(false);
  const [dutyError, setDutyError] = useState('');
  const [deliveredTotal, setDeliveredTotal] = useState(0);
  const [pendingWaysCount, setPendingWaysCount] = useState(0);
  const [onWaysCount, setOnWaysCount] = useState(0);
  const [assignedPickupsCount, setAssignedPickupsCount] = useState(0);
  const [dashboardError, setDashboardError] = useState('');
  const loadSequence = useRef(0);

  const checkAuthAndLoadData = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const timeoutId = setTimeout(() => {
      if (sequence !== loadSequence.current) return;
      console.error('Home dashboard data loading exceeded the time limit.');
      setDashboardError('အချက်အလက်ရယူရန် ကြာမြင့်နေပါသည်။ အင်တာနက်ကိုစစ်ပြီး ပြန်ကြိုးစားပါ။');
      setLoading(false);
      setRefreshing(false);
    }, DASHBOARD_LOAD_TIMEOUT_MS);

    try {
      setDashboardError('');
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session) {
        router.replace('/login');
        return;
      }

      const email = session.user.email;
      if (!email) {
        router.replace('/login');
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('rider_id')
        .eq('email', email)
        .maybeSingle();
      if (profileError) throw profileError;

      if (!profileData?.rider_id) {
        setRiderId(null);
        setRiderName(email.split('@')[0]);
        setOnWaysCount(0);
        setPendingWaysCount(0);
        setAssignedPickupsCount(0);
        setDashboardError('ဤ email အတွက် rider profile မတွေ့ပါ။');
        return;
      }

      void startBroadcastingLocation(String(profileData.rider_id)).catch((error: unknown) => {
        console.error('Automatic rider location start failed; retry will continue.', error);
      });

      const [riderResult, onWaysResult, pendingResult, pickupsResult] = await Promise.all([
        supabase
          .from('riders')
          .select('name, is_on_duty')
          .eq('id', profileData.rider_id)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('deliver_rider_id', profileData.rider_id)
          .eq('status', 'On Way')
          .eq('is_deleted', false),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('deliver_rider_id', profileData.rider_id)
          .eq('status', 'Handover')
          .eq('is_deleted', false),
        supabase
          .from('pickups')
          .select('id', { count: 'exact', head: true })
          .eq('rider_id', profileData.rider_id)
          .in('status', ['Assigned', 'Assgined']),
      ]);

      if (riderResult.error) throw riderResult.error;
      if (onWaysResult.error) throw onWaysResult.error;
      if (pendingResult.error) throw pendingResult.error;
      if (pickupsResult.error) throw pickupsResult.error;

      setRiderId(profileData.rider_id);
      setIsOnDuty(riderResult.data?.is_on_duty === true);
      setRiderName(riderResult.data?.name || email.split('@')[0]);
      setDashboardError('');
      setOnWaysCount(onWaysResult.count ?? 0);
      setPendingWaysCount(pendingResult.count ?? 0);
      setAssignedPickupsCount(pickupsResult.count ?? 0);
      setLoading(false);
      setRefreshing(false);

      void (async () => {
        let total = 0;
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
          const { data, error: deliveredError } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('deliver_rider_id', profileData.rider_id)
            .eq('status', 'Delivered')
            .eq('is_deleted', false)
            .order('id', { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (deliveredError) throw deliveredError;

          for (const way of data ?? []) {
            const amount = Number(way.total_amount);
            if (Number.isFinite(amount)) total += amount;
          }
          if (!data || data.length < pageSize) break;
        }
        setDeliveredTotal(total);
      })().catch((error: unknown) => {
        console.error('Could not load delivered total:', error);
        setDashboardError('ပို့ဆောင်ပြီးငွေ စုစုပေါင်းကို ရယူ၍မရပါ။');
      });
    } catch {
      setDashboardError('ပင်မစာမျက်နှာ အချက်အလက်များ ရယူ၍မရပါ။ အင်တာနက်ကိုစစ်ပြီး ပြန်ကြိုးစားပါ။');
    } finally {
      clearTimeout(timeoutId);
      if (sequence === loadSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const toggleDuty = useCallback(async () => {
    if (riderId == null || dutySaving) return;

    const nextDutyState = !isOnDuty;
    setDutySaving(true);
    setDutyError('');

    try {
      const { data, error } = await supabase
        .from('riders')
        .update({ is_on_duty: nextDutyState })
        .eq('id', riderId)
        .select('is_on_duty')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('Rider record was not updated.');
      if (data.is_on_duty !== nextDutyState) {
        throw new Error('The saved duty status did not match the requested status.');
      }

      setIsOnDuty(data.is_on_duty);
    } catch (error: unknown) {
      console.error('Could not update rider duty status:', error);
      setDutyError('Duty status ကို ပြောင်းလဲ၍မရပါ။ အင်တာနက် သို့မဟုတ် database ခွင့်ပြုချက်ကို စစ်ဆေးပြီး ထပ်ကြိုးစားပါ။');
    } finally {
      setDutySaving(false);
    }
  }, [dutySaving, isOnDuty, riderId]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void checkAuthAndLoadData();
  }, [checkAuthAndLoadData]);

  useFocusEffect(
    useCallback(() => {
      void checkAuthAndLoadData();
    }, [checkAuthAndLoadData]),
  );

  if (loading) {
    return React.createElement(HomeLoadingSkeleton, { isDark });
  }

  return React.createElement(
    SafeAreaView,
    { style: styles.safeArea },
    React.createElement(StatusBar, {
      barStyle: isDark ? 'light-content' : 'dark-content',
    }),
    React.createElement(
      ScrollView,
      {
        style: styles.container,
        contentContainerStyle: styles.scrollContent,
        refreshControl: React.createElement(PullToRefreshControl, {
          refreshing: refreshing,
          onRefresh: onRefresh,
          colors: ['#0284c7'],
        }),
      },

      // Top Header with Express Branding & Rider Profile
      React.createElement(
        View,
        { style: styles.headerCard },

// All In One Express Logo Placeholder
        React.createElement(
          View,
          { style: styles.logoContainer },
          /* Logo ရပြီဆိုပါက require('../../assets/images/logo.png') သို့ပြောင်းနိုင်ပါသည် */
          React.createElement(Image, {
            source: require('../../assets/images/logo.png'),
            style: styles.logoImage,
            resizeMode: 'contain',
          })
        ),


        React.createElement(
          View,
          { style: styles.headerLeft },
          React.createElement(
            View,
            { style: [styles.statusBadge, isOnDuty ? styles.statusBadgeOn : styles.statusBadgeOff] },
            React.createElement(View, { style: [styles.statusDot, isOnDuty ? styles.statusDotOn : styles.statusDotOff] }),
            React.createElement(Text, { style: [styles.statusText, isOnDuty ? styles.statusTextOn : styles.statusTextOff] }, isOnDuty ? 'On Duty' : 'Off Duty')
          ),
          React.createElement(Text, { style: styles.greeting }, 'ပြန်လည်ကြိုဆိုပါတယ်'),
          React.createElement(Text, { style: styles.riderName }, riderName || 'Rider')
        ),

      
      ),

      React.createElement(
        View,
        { style: styles.dutyCard },
        React.createElement(
          View,
          { style: styles.dutyInfo },
          React.createElement(Text, { style: styles.dutyTitle }, 'Duty Status'),
          React.createElement(
            Text,
            { style: styles.dutySubtitle },
            isOnDuty ? 'You are currently On Duty' : 'You are currently Off Duty',
          ),
        ),
        React.createElement(
          TouchableOpacity,
          {
            style: [styles.dutyToggle, isOnDuty ? styles.dutyToggleOn : styles.dutyToggleOff],
            onPress: () => void toggleDuty(),
            disabled: riderId == null || dutySaving,
            activeOpacity: 0.8,
            accessibilityRole: 'switch',
            accessibilityLabel: isOnDuty ? 'On Duty' : 'Off Duty',
            accessibilityState: { checked: isOnDuty, disabled: riderId == null || dutySaving },
          },
          dutySaving
            ? React.createElement(ActivityIndicator, { size: 'small', color: isOnDuty ? '#15803d' : '#475569' })
            : React.createElement(Ionicons, {
                name: isOnDuty ? 'toggle' : 'toggle-outline',
                size: 20,
                color: isOnDuty ? '#15803d' : '#475569',
              }),
          React.createElement(
            Text,
            { style: [styles.dutyToggleText, isOnDuty ? styles.dutyToggleTextOn : styles.dutyToggleTextOff] },
            isOnDuty ? 'On Duty' : 'Off Duty',
          ),
        ),
        dutyError
          ? React.createElement(Text, { style: styles.dutyError }, dutyError)
          : null,
      ),

      // Error Banner
      dashboardError
        ? React.createElement(
            View,
            { style: styles.errorBanner },
            React.createElement(Ionicons, { name: 'alert-circle-outline', size: 18, color: '#ef4444' }),
            React.createElement(Text, { style: styles.dashboardError }, dashboardError)
          )
        : null,

    

      // Stats Grid
      React.createElement(
        View,
        { style: styles.statsGrid },

        // Card 1: အပ်ရန်ကျန်ရှိငွေ
        React.createElement(
          TouchableOpacity,
          {
            style: [styles.statCard, styles.cashCard],
            onPress: () => router.push('/delivered'),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
            accessibilityLabel: `အပ်ရန်ကျန်ရှိငွေ ${deliveredTotal.toLocaleString()} ကျပ်ကို ကြည့်ရန်`,
          },
          React.createElement(
            View,
            { style: styles.cardHeaderRow },
            React.createElement(
              View,
              { style: [styles.iconCircle, { backgroundColor: isDark ? '#172b45' : '#e0f2fe' }] },
              React.createElement(Ionicons, { name: 'wallet-outline', size: 20, color: '#0284c7' })
            ),
            React.createElement(Text, { style: styles.statLabel }, 'အပ်ရန်ကျန်ရှိငွေ')
          ),
          React.createElement(
            Text,
            { style: styles.statValue },
            dashboardError ? '-' : deliveredTotal.toLocaleString(),
            ' ',
            React.createElement(Text, { style: styles.currency }, 'ကျပ်')
            
          ),
          

        ),

        // Card 2: Pending Ways
        React.createElement(
          TouchableOpacity,
          {
            style: [styles.statCard, styles.pendingCard],
            onPress: () => router.push('/pending-ways'),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
            accessibilityLabel: `Pending Ways ${pendingWaysCount} ခုကို ကြည့်ရန်`,
          },
          React.createElement(
            View,
            { style: styles.cardHeaderRow },
            React.createElement(
              View,
              { style: [styles.iconCircle, { backgroundColor: isDark ? '#3b2a1b' : '#ffedd5' }] },
              React.createElement(Ionicons, { name: 'time-outline', size: 20, color: '#f97316' })
            ),
            React.createElement(Text, { style: styles.statLabel }, 'Pending Ways')
          ),
          React.createElement(
            View,
            { style: styles.statValueRow },
            React.createElement(
              Text,
              { style: [styles.statValue, { color: '#f97316' }] },
              dashboardError ? '-' : pendingWaysCount,
              ' ',
              React.createElement(Text, { style: styles.currency }, 'ခု')
            ),
            
          )
        )
      ),

      React.createElement(
        TouchableOpacity,
        {
          style: styles.assignedPickupsCard,
          onPress: () => router.push('../pickups'),
          activeOpacity: 0.8,
          accessibilityRole: 'button',
          accessibilityLabel: `Assigned Pickups ${assignedPickupsCount} ခုကို ကြည့်ရန်`,
        },
        React.createElement(
          View,
          { style: styles.assignedPickupsIcon },
          React.createElement(Ionicons, { name: 'cube-outline', size: 23, color: '#f97316' })
        ),
        React.createElement(
          View,
          { style: styles.assignedPickupsText },
          React.createElement(Text, { style: styles.assignedPickupsTitle }, 'Assigned Pickups'),
          React.createElement(Text, { style: styles.assignedPickupsSubtitle }, 'ကောက်ယူရန် ကျန်ရှိသော ပစ္စည်းများ')
        ),
        React.createElement(
          View,
          { style: styles.assignedPickupsCountBadge },
          React.createElement(
            Text,
            { style: styles.assignedPickupsCount },
            dashboardError ? '-' : assignedPickupsCount
          )
        ),
        React.createElement(Ionicons, { name: 'chevron-forward', size: 20, color: '#c2410c' })
      ),

      React.createElement(
        View,
        { style: styles.quickActionsRow },
        React.createElement(
          TouchableOpacity,
          {
            style: styles.quickScanItem,
            onPress: () => router.push({ pathname: '/ways', params: { autoScan: '1' } }),
            activeOpacity: 0.85,
            accessibilityRole: 'button',
            accessibilityLabel: 'ပစ္စည်း scan ဖတ်ပြီး Delivered လုပ်ရန်',
          },
          React.createElement(
            View,
            { style: styles.quickScanIcon },
            React.createElement(Ionicons, { name: 'scan-outline', size: 22, color: '#ffffff' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.quickScanTitle }, 'Scan ပြီး Delivered'),
            React.createElement(Text, { style: styles.quickScanSubTitle }, 'QR / Barcode scan')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 16, color: '#ffffff' })
        ),
        React.createElement(
          TouchableOpacity,
          {
            style: styles.intakeActionItem,
            onPress: () => router.push('/intake'),
            activeOpacity: 0.85,
            accessibilityRole: 'button',
            accessibilityLabel: 'Parcel intake page ကို ဖွင့်ရန်',
          },
          React.createElement(
            View,
            { style: styles.intakeActionIcon },
            React.createElement(Ionicons, { name: 'add-circle-outline', size: 22, color: '#ffffff' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.intakeActionTitle }, 'Intake to Parcel'),
            React.createElement(Text, { style: styles.intakeActionSubTitle }, 'ပစ္စည်းအသစ် စာရင်းသွင်းရန်')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 16, color: '#ffffff' })
        )
      ),

     
      // Quick Actions List
      React.createElement(
        View,
        { style: styles.menuContainer },

       

        

       

        // Menu 1: လမ်းကြောင်းများ
        React.createElement(
          TouchableOpacity,
          {
            style: styles.menuItem,
            onPress: () => router.push('/ways'),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
            accessibilityLabel: `On Ways ${dashboardError ? '' : onWaysCount} ခုကို ကြည့်ရန်`,
          },
          React.createElement(
            View,
            { style: [styles.menuIconBox, { backgroundColor: isDark ? '#172b45' : '#e0f2fe' }] },
            React.createElement(Ionicons, { name: 'bicycle-outline', size: 20, color: '#0284c7' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'On ways'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'ယနေ့ ပို့ဆောင်ရမည့် ပါဆယ်များ စာရင်း')
          ),
          React.createElement(
            View,
            { style: [styles.onWaysCountBadge, isDark && { backgroundColor: '#172b45' }] },
            React.createElement(
              Text,
              { style: [styles.onWaysCountText, isDark && { color: '#7dd3fc' }] },
              dashboardError ? '-' : onWaysCount,
              ' ခု'
            )
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 18, color: '#cbd5e1' })
        ),

        React.createElement(View, { style: styles.divider }),

        // Menu 2: Delivered List
        React.createElement(
          TouchableOpacity,
          { style: styles.menuItem, onPress: () => router.push('/delivered'), activeOpacity: 0.7 },
          React.createElement(
            View,
            { style: [styles.menuIconBox, { backgroundColor: isDark ? '#173326' : '#dcfce7' }] },
            React.createElement(Ionicons, { name: 'checkmark-done-circle-outline', size: 20, color: '#16a34a' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'Delivered'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'ပို့ဆောင်ပြီးသွားသော လမ်းကြောင်းများ')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 18, color: '#cbd5e1' })
        ),

         React.createElement(View, { style: styles.divider }),

        // Menu 3: Map
        React.createElement(
          TouchableOpacity,
          { style: styles.menuItem, onPress: () => router.push('/map'), activeOpacity: 0.7 },
          React.createElement(
            View,
            { style: [styles.menuIconBox, { backgroundColor: isDark ? '#531a09' : '#fcf4dc' }] },
            React.createElement(Ionicons, { name: 'map-outline', size: 20, color: '#a36616' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'Map'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'လမ်းကြောင်းများ ပြသရန်')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 18, color: '#cbd5e1' })
        ),

       
      )
    )
  );
}

const baseStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 110 }, // Bottom Floating Dock ထိမနေစေရန် padding ပိုပေးထားပါသည်

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  loadingContent: { width: '100%', maxWidth: 480, paddingHorizontal: 18 },
  loadingHeader: { minHeight: 104, flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, gap: 14, marginBottom: 14, elevation: 2, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10 },
  loadingLogo: { width: 60, height: 60, borderRadius: 18 },
  loadingHeaderText: { flex: 1, gap: 9 },
  loadingStats: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  loadingStatCard: { flex: 1, height: 112, borderRadius: 18, padding: 14, justifyContent: 'space-between', elevation: 2, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8 },
  loadingPickupCard: { minHeight: 74, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  loadingIcon: { width: 42, height: 42, borderRadius: 13 },
  loadingPickupText: { flex: 1, gap: 8 },
  loadingQuickAction: { minHeight: 70, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  loadingLine: { height: 11, borderRadius: 6 },
  loadingMenu: { borderRadius: 16, paddingHorizontal: 14, marginBottom: 8 },
  loadingMenuRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingMenuIcon: { width: 38, height: 38, borderRadius: 12 },
  loadingText: { alignSelf: 'center', marginTop: 8, color: '#64748b', fontSize: 13, fontWeight: '500' },

  // Header Styles
  headerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  headerLeft: { flex: 1 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  statusBadgeOn: { backgroundColor: '#f0fdf4' },
  statusBadgeOff: { backgroundColor: '#f1f5f9' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusDotOn: { backgroundColor: '#22c55e' },
  statusDotOff: { backgroundColor: '#64748b' },
  statusText: { fontSize: 11, fontWeight: '600' },
  statusTextOn: { color: '#15803d' },
  statusTextOff: { color: '#475569' },
  greeting: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  riderName: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginTop: 2 },
  dutyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    padding: 14,
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    backgroundColor: '#ffffff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  dutyInfo: { flex: 1, minWidth: 150 },
  dutyTitle: { color: '#334155', fontSize: 14, fontWeight: '700' },
  dutySubtitle: { color: '#64748b', fontSize: 12, marginTop: 4 },
  dutyToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
  },
  dutyToggleOn: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  dutyToggleOff: { backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' },
  dutyToggleText: { fontSize: 13, fontWeight: '700' },
  dutyToggleTextOn: { color: '#15803d' },
  dutyToggleTextOff: { color: '#475569' },
  dutyError: { flexBasis: '100%', color: '#b91c1c', fontSize: 12 },

  // Logo Placeholder Style
  logoContainer: {
    width: 100,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 0,
    borderColor: '#e2e8f0',
  },
  logoImage: { width: '100%', height: '100%' },

  // Error Banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  dashboardError: { color: '#ef4444', fontSize: 13, fontWeight: '500', flex: 1 },

  // Section Styles
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#334155', marginBottom: 12, marginLeft: 2 },

  // Stats Grid Styles
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  cashCard: { borderTopWidth: 3, borderTopColor: '#0284c7' },
  pendingCard: { borderTopWidth: 3, borderTopColor: '#f97316' },
  assignedPickupsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 15,
    marginBottom: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fed7aa',
    backgroundColor: '#fff7ed',
  },
  assignedPickupsIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffedd5',
  },
  assignedPickupsText: { flex: 1 },
  assignedPickupsTitle: { color: '#9a3412', fontSize: 15, fontWeight: '800' },
  assignedPickupsSubtitle: { color: '#c2410c', fontSize: 11, marginTop: 3 },
  assignedPickupsCountBadge: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  assignedPickupsCount: { color: '#c2410c', fontSize: 16, fontWeight: '800' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  iconCircle: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  statLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '800', color: '#0284c7' },
  statValueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  currency: { fontSize: 12, fontWeight: '500', color: '#94a3b8' },

  // Menu Styles
  menuContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    paddingVertical: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  quickScanItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 82,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#f97316',
  },
  quickScanIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: '#ea580c',
  },
  quickScanTitle: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  quickScanSubTitle: { fontSize: 9, color: '#fff7ed', marginTop: 3 },
  intakeActionItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 82,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#16a34a',
  },
  intakeActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: '#15803d',
  },
  intakeActionTitle: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  intakeActionSubTitle: { fontSize: 9, color: '#dcfce7', marginTop: 3 },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  onWaysCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 10,
    borderRadius: 12,
    backgroundColor: '#e0f2fe',
  },
  onWaysCountText: { color: '#0284c7', fontSize: 12, fontWeight: '700' },
  menuIconBox: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  menuTextContainer: { flex: 1 },
  menuTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  menuSubTitle: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginHorizontal: 14 },
});