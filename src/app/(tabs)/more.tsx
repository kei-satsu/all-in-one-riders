import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageLoadingSkeleton } from '../../components/page-loading-skeleton';
import { PullToRefreshControl } from '../../components/pull-to-refresh-control';
import {
    loadLastKnownLocation,
    stopBroadcastingLocation,
    subscribeToLocationBroadcastStatus,
    type LocationBroadcastStatus,
} from '../../lib/location-broadcast';
import { supabase } from '../../lib/supabase';
import { useAppTheme, useThemeStyles } from '../../lib/theme-provider';

export default function MoreScreen() {
  const { isDark, ready: themeReady, toggleTheme } = useAppTheme();
  const styles = useThemeStyles(baseStyles);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [riderName, setRiderName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [profileError, setProfileError] = useState('');
  const [locationStatus, setLocationStatus] = useState<LocationBroadcastStatus>({
    state: 'idle',
    isRunning: false,
    lastSentAt: null,
    lastPosition: null,
    error: null,
  });
  const [logoutMenuVisible, setLogoutMenuVisible] = useState(false);

  useEffect(
    () => subscribeToLocationBroadcastStatus(setLocationStatus),
    []
  );

  const loadProfile = useCallback(async () => {
    try {
      setProfileError('');
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const email = session?.user.email;
      if (!email) {
        router.replace('/login');
        return;
      }

      setUserEmail(email);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('rider_id')
        .eq('email', email)
        .maybeSingle();
      if (profileError) throw profileError;

      if (profile?.rider_id) {
        const lastKnownLocation = await loadLastKnownLocation(String(profile.rider_id)).catch((error: unknown) => {
          console.error('Could not load the last saved rider location.', error);
          return null;
        });
        if (lastKnownLocation) {
          setLocationStatus((current) => {
            if (current.lastSentAt && current.lastSentAt >= lastKnownLocation.timestamp) {
              return current;
            }
            return {
              ...current,
              lastPosition: {
                latitude: lastKnownLocation.latitude,
                longitude: lastKnownLocation.longitude,
              },
              lastSentAt: lastKnownLocation.timestamp,
            };
          });
        }

        const { data: rider, error: riderError } = await supabase
          .from('riders')
          .select('name')
          .eq('id', profile.rider_id)
          .maybeSingle();
        if (riderError) throw riderError;
        setRiderName(rider?.name || email.split('@')[0]);
      } else {
        setRiderName(email.split('@')[0]);
      }
    } catch {
      setProfileError('Rider profile အချက်အလက်များ ရယူ၍မရပါ။');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  const performLogout = async () => {
    try {
      await stopBroadcastingLocation();
    } catch (error) {
      setProfileError(
        `Location ရပ်ရန် မအောင်မြင်ပါ: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      setProfileError(`Logout မအောင်မြင်ပါ။ အင်တာနက်ကိုစစ်ပြီး ထပ်မံကြိုးစားပါ။ ${error.message}`);
      return;
    }
    router.replace('/login');
  };

  const handleLogout = () => {
    const message = 'အကောင့်ထဲမှ ထွက်ရန် သေချာပါသလားဟင်။';
    if (Platform.OS === 'web') {
      if (window.confirm(message)) void performLogout();
      return;
    }

    Alert.alert('Logout ထွက်မည်', message, [
      { text: 'မထွက်ပါ', style: 'cancel' },
      {
        text: 'ထွက်မည်',
        style: 'destructive',
        onPress: () => void performLogout(),
      },
    ]);
  };

  return React.createElement(
    SafeAreaView,
    { style: styles.safeArea },
    React.createElement(StatusBar, { barStyle: isDark ? 'light-content' : 'dark-content' }),
    React.createElement(
      ScrollView,
      {
        style: styles.container,
        contentContainerStyle: styles.scrollContent,
        refreshControl: React.createElement(PullToRefreshControl, {
          refreshing: refreshing,
          onRefresh: onRefresh,
          colors: ['#f97316'],
        }),
      },

      // Profile Card Section
      React.createElement(
        View,
        { style: styles.profileCard },
        React.createElement(
          TouchableOpacity,
          {
            style: styles.themeToggleButton,
            onPress: () => {
              void toggleTheme().catch((error: unknown) => {
                setProfileError(
                  `Theme ပြောင်းမရပါ: ${error instanceof Error ? error.message : String(error)}`,
                );
              });
            },
            disabled: !themeReady,
            activeOpacity: 0.7,
            accessibilityRole: 'button',
            accessibilityLabel: isDark ? 'Light Mode သို့ပြောင်းရန်' : 'Dark Mode သို့ပြောင်းရန်',
          },
          React.createElement(Ionicons, {
            name: isDark ? 'sunny-outline' : 'moon-outline',
            size: 20,
            color: isDark ? '#fbbf24' : '#64748b',
          })
        ),
        React.createElement(
          TouchableOpacity,
          {
            style: styles.profileMenuButton,
            onPress: () => setLogoutMenuVisible((visible) => !visible),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
            accessibilityLabel: 'Profile menu',
            accessibilityState: { expanded: logoutMenuVisible },
          },
          React.createElement(Ionicons, { name: 'ellipsis-vertical', size: 20, color: '#64748b' })
        ),
        logoutMenuVisible
          ? React.createElement(
              View,
              { style: styles.profileMenu },
              React.createElement(
                TouchableOpacity,
                {
                  style: styles.profileMenuItem,
                  onPress: () => {
                    setLogoutMenuVisible(false);
                    handleLogout();
                  },
                  activeOpacity: 0.7,
                  accessibilityRole: 'button',
                },
                React.createElement(Ionicons, { name: 'log-out-outline', size: 18, color: '#ef4444' }),
                React.createElement(Text, { style: styles.profileMenuText }, 'Logout')
              )
            )
          : null,
        React.createElement(
          View,
          { style: styles.avatarContainer },
          React.createElement(Ionicons, { name: 'person', size: 40, color: '#f97316' })
        ),
        loading
          ? React.createElement(PageLoadingSkeleton, {
              isDark,
              variant: 'profile',
              count: 1,
              inline: true,
            })
          : React.createElement(
              View,
              { style: styles.profileInfo },
              React.createElement(Text, { style: styles.riderName }, riderName || 'Rider'),
              userEmail ? React.createElement(Text, { style: styles.riderEmail }, userEmail) : null,
              profileError ? React.createElement(Text, { style: styles.profileError }, profileError) : null
            )
      ),

      React.createElement(
        View,
        { style: styles.locationCard },
        React.createElement(
          View,
          { style: styles.locationHeader },
          React.createElement(
            View,
            { style: styles.locationHeading },
            React.createElement(
              View,
              {
                style: [
                  styles.locationStatusDot,
                  locationStatus.state === 'broadcasting'
                    ? styles.locationStatusDotActive
                    : locationStatus.state === 'error'
                      ? styles.locationStatusDotError
                      : null,
                ],
              }
            ),
            React.createElement(
              View,
              { style: styles.locationTitleGroup },
              React.createElement(Text, { style: styles.locationTitle }, 'Live Location'),
              React.createElement(
                Text,
                {
                  style: [
                    styles.locationState,
                    locationStatus.state === 'broadcasting'
                      ? styles.locationStateActive
                      : locationStatus.state === 'error'
                        ? styles.locationStateError
                        : null,
                  ],
                },
                locationStatus.state === 'broadcasting'
                  ? 'ပို့နေသည်'
                  : locationStatus.state === 'starting'
                    ? 'စတင်နေသည်'
                    : locationStatus.state === 'waiting'
                      ? 'GPS စောင့်နေသည်'
                      : locationStatus.state === 'sending'
                        ? 'ပို့နေသည်'
                        : locationStatus.state === 'error'
                          ? 'အမှား'
                          : 'ရပ်ထားသည်'
              )
            )
          ),
          locationStatus.state === 'starting' || locationStatus.state === 'waiting'
            ? React.createElement(ActivityIndicator, { size: 'small', color: '#16a34a' })
            : null
        ),
       /* React.createElement(
          Text,
          { style: styles.locationDetail },
          'App ဖွင့်ထားချိန်နှင့် background တွင် location ကို live ပို့ပါမည်။'
        ),*/
        locationStatus.lastPosition
          ? React.createElement(
              Text,
              { style: styles.locationMeta },
              `နောက်ဆုံး GPS ရရှိခဲ့သော တည်နေရာ: ${locationStatus.lastPosition.latitude.toFixed(6)}, ${locationStatus.lastPosition.longitude.toFixed(6)}`
            )
          : null,
        locationStatus.lastSentAt
          ? React.createElement(
              Text,
            { style: styles.locationMeta },
            `နောက်ဆုံး GPS ရရှိချိန် ${new Date(locationStatus.lastSentAt).toLocaleTimeString()}`
            )
          : null,
        locationStatus.error
          ? React.createElement(
              Text,
              { style: styles.locationError },
              locationStatus.error
            )
            : null,
      ),

      React.createElement(
        View,
        { style: styles.menuGroup },

        React.createElement(
          TouchableOpacity,
          {
            style: styles.menuItem,
            onPress: () => router.push('/intake' as Href),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
          },
          React.createElement(
            View,
            { style: [styles.menuIcon, styles.infoIconBg] },
            React.createElement(Ionicons, { name: 'camera-outline', size: 20, color: '#c2410c' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'Parcel Intake'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'ပါဆယ်အဝင်ဓာတ်ပုံနှင့် barcode မှတ်တမ်းတင်ရန်')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 18, color: '#cbd5e1' })
        ),

        React.createElement(View, { style: styles.divider }),

        // Menu 1: Delivered List
        React.createElement(
          TouchableOpacity,
          {
            style: styles.menuItem,
            onPress: () => router.push('../completed-ways'),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
          },
          React.createElement(
            View,
            { style: [styles.menuIcon, styles.deliveredIconBg] },
            React.createElement(Ionicons, { name: 'checkmark-done-circle-outline', size: 20, color: '#16a34a' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'Completed Delivery List'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'ပြီးမြောက်ထားသော Ways များ')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 18, color: '#cbd5e1' })
        ),

        React.createElement(View, { style: styles.divider }),

        React.createElement(
          TouchableOpacity,
          {
            style: styles.menuItem,
            onPress: () => router.push('/pickup-ways'),
            activeOpacity: 0.7,
            accessibilityRole: 'button',
          },
          React.createElement(
            View,
            { style: [styles.menuIcon, styles.infoIconBg] },
            React.createElement(Ionicons, { name: 'cube-outline', size: 20, color: '#c2410c' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'Pickup Ways'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'လက်ခံရက်အလိုက် Pickup စာရင်း')
          ),
          React.createElement(Ionicons, { name: 'chevron-forward', size: 18, color: '#cbd5e1' })
        ),

        

       
      ),

     
      React.createElement(
        View,
        { style: styles.menuGroup },
        React.createElement(
          View,
          { style: styles.menuItem },
          React.createElement(
            View,
            { style: [styles.menuIcon, styles.infoIconBg] },
            React.createElement(Ionicons, { name: 'information-circle-outline', size: 20, color: '#f97316' })
          ),
          React.createElement(
            View,
            { style: styles.menuTextContainer },
            React.createElement(Text, { style: styles.menuTitle }, 'App Version'),
            React.createElement(Text, { style: styles.menuSubTitle }, 'All In One Express v1.0.0')
          )
        )
      ),

    )
  );
}

const baseStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 110 },

  profileCard: {
    position: 'relative',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  profileMenuButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#f8fafc',
  },
  themeToggleButton: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#f8fafc',
  },
  profileMenu: {
    position: 'absolute',
    top: 48,
    right: 12,
    zIndex: 3,
    minWidth: 140,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  profileMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  profileMenuText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ffedd5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  profileInfo: { alignItems: 'center' },
  riderName: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  riderEmail: { fontSize: 13, color: '#64748b', marginTop: 2, fontWeight: '500' },
  profileError: { marginTop: 6, color: '#ef4444', fontSize: 12, fontWeight: '500' },
  locationCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 15,
  },
  locationHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  locationHeading: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  locationTitleGroup: { flex: 1 },
  locationStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#94a3b8',
    marginRight: 8,
  },
  locationStatusDotActive: { backgroundColor: '#16a34a' },
  locationStatusDotError: { backgroundColor: '#ef4444' },
  locationTitle: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
  locationState: { color: '#64748b', fontSize: 11, fontWeight: '600', marginTop: 1 },
  locationStateActive: { color: '#16a34a' },
  locationStateError: { color: '#ef4444' },
  locationDetail: { color: '#64748b', fontSize: 11, lineHeight: 15, marginTop: 2 },
  locationMeta: { color: '#94a3b8', fontSize: 10, lineHeight: 14, marginTop: 2 },
  locationError: { color: '#dc2626', fontSize: 11, lineHeight: 15, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 10, marginLeft: 2 },

  menuGroup: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 20,
    paddingVertical: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  deliveredIconBg: { backgroundColor: '#dcfce7' },
  pendingIconBg: { backgroundColor: '#ffedd5' },
  infoIconBg: { backgroundColor: '#ffedd5' },
  menuTextContainer: { flex: 1 },
  menuTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  menuSubTitle: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginHorizontal: 14 },

});