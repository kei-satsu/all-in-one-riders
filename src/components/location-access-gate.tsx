import { Ionicons } from '@expo/vector-icons';
import { isRunningInExpoGo } from 'expo';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAppTheme } from '../lib/theme-provider';

type GateStatus =
  | 'checking-session'
  | 'checking-location'
  | 'permission-required'
  | 'background-permission-required'
  | 'services-required'
  | 'error'
  | 'ready';

export function LocationAccessGate({ children }: PropsWithChildren) {
  const { isDark } = useAppTheme();
  const [status, setStatus] = useState<GateStatus>('checking-session');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const isAuthenticatedRef = useRef(false);
  const authInitialized = useRef(false);
  const sessionUserId = useRef<string | null>(null);
  const accessWasGranted = useRef(false);
  const [hasLocationAccess, setHasLocationAccess] = useState(false);

  const updateLocationAccess = useCallback((granted: boolean) => {
    accessWasGranted.current = granted;
    setHasLocationAccess(granted);
  }, []);

  const checkLocationAccess = useCallback(async (requestPermission: boolean) => {
    if (!accessWasGranted.current) {
      setStatus('checking-location');
      setErrorMessage('');
    }

    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!isAuthenticatedRef.current) {
        updateLocationAccess(true);
        setStatus('ready');
        return;
      }

      if (!permission.granted && requestPermission && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      if (!isAuthenticatedRef.current) {
        setStatus('ready');
        return;
      }

      setCanAskAgain(permission.canAskAgain);
      if (!permission.granted) {
        updateLocationAccess(false);
        setStatus('permission-required');
        return;
      }

      if (Platform.OS !== 'web' && !isRunningInExpoGo()) {
        const backgroundPermission = await Location.getBackgroundPermissionsAsync();

        if (!isAuthenticatedRef.current) {
          updateLocationAccess(true);
          setStatus('ready');
          return;
        }

        setCanAskAgain(backgroundPermission.canAskAgain);
        if (!backgroundPermission.granted) {
          updateLocationAccess(false);
          setStatus('background-permission-required');
          return;
        }
      }

      if (Platform.OS !== 'web') {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!isAuthenticatedRef.current) {
          updateLocationAccess(true);
          setStatus('ready');
          return;
        }
        if (!servicesEnabled) {
          updateLocationAccess(false);
          setStatus('services-required');
          return;
        }
      }

      updateLocationAccess(true);
      setStatus('ready');
    } catch (error: unknown) {
      if (!isAuthenticatedRef.current) {
        updateLocationAccess(true);
        setStatus('ready');
        return;
      }
      console.error('Could not verify location access.', error);
      if (accessWasGranted.current) {
        setStatus('ready');
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [updateLocationAccess]);

  const updateSession = useCallback((userId: string | null) => {
    sessionUserId.current = userId;
    authInitialized.current = true;
    isAuthenticatedRef.current = Boolean(userId);
    setIsAuthenticated(Boolean(userId));

    if (userId) {
      void checkLocationAccess(Platform.OS !== 'web');
    } else {
      updateLocationAccess(true);
      setStatus('ready');
      setErrorMessage('');
    }
  }, [checkLocationAccess, updateLocationAccess]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !authInitialized.current) return;
      const userId = session?.user.id ?? null;
      if (sessionUserId.current === userId) return;
      updateSession(userId);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error('Could not check the rider session before location access.', error);
        setErrorMessage(error.message);
        setStatus('error');
        authInitialized.current = true;
        return;
      }

      updateSession(data.session?.user.id ?? null);
    }).catch((error: unknown) => {
      if (!active) return;
      console.error('Could not check the rider session before location access.', error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
      authInitialized.current = true;
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [updateSession]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isAuthenticatedRef.current) {
        void checkLocationAccess(false);
      }
    });

    return () => subscription.remove();
  }, [checkLocationAccess]);

  if (Platform.OS === 'web') {
    return <>{children}</>;
  }

  const handleContinue = async () => {
    setErrorMessage('');
    try {
      if (status === 'permission-required') {
        if (Platform.OS !== 'web' && !canAskAgain) {
          await Linking.openSettings();
        } else {
          const permission = await Location.requestForegroundPermissionsAsync();
          setCanAskAgain(permission.canAskAgain);
        }
        await checkLocationAccess(false);
        return;
      }

      if (status === 'background-permission-required') {
        if (!canAskAgain) {
          await Linking.openSettings();
        } else {
          const permission = await Location.requestBackgroundPermissionsAsync();
          setCanAskAgain(permission.canAskAgain);
        }
        await checkLocationAccess(false);
        return;
      }

      if (status === 'services-required') {
        if (Platform.OS === 'android') {
          await Location.enableNetworkProviderAsync();
        } else {
          await Linking.openSettings();
        }
        await checkLocationAccess(false);
        return;
      }

      if (isAuthenticated) {
        await checkLocationAccess(true);
        return;
      }

      setStatus('checking-session');
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      updateSession(data.session?.user.id ?? null);
    } catch (error: unknown) {
      console.error('Could not continue to the app without location access.', error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  };

  if (status === 'ready' || (hasLocationAccess && status === 'checking-location')) {
    return <>{children}</>;
  }

  const backgroundColor = isDark ? '#0b1220' : '#f8fafc';
  const cardColor = isDark ? '#151c2a' : '#ffffff';
  const textColor = isDark ? '#f1f5f9' : '#0f172a';
  const secondaryColor = isDark ? '#a8b3c5' : '#64748b';
  const title = status === 'permission-required'
    ? 'တည်နေရာခွင့်ပြုချက် လိုအပ်ပါသည်'
    : status === 'background-permission-required'
      ? 'နောက်ခံတည်နေရာခွင့်ပြုချက် လိုအပ်ပါသည်'
    : status === 'services-required'
      ? 'ဖုန်း၏ Location ကို ဖွင့်ပါ'
      : status === 'error'
        ? 'တည်နေရာကို စစ်ဆေးမရပါ'
        : 'တည်နေရာကို စစ်ဆေးနေပါသည်';
  const description = status === 'permission-required'
    ? 'ဆက်လက်အသုံးပြုရန် Location permission ကို ခွင့်ပြုပေးပါ။ မေးခွန်းပေါ်လာလျှင် ခွင့်ပြုပေးပါ။ ခွင့်မပြုထားသရွေ့ app ထဲသို့ ဆက်မဝင်နိုင်ပါ။'
    : status === 'background-permission-required'
      ? 'App ကို နောက်ခံထားချိန်နှင့် မျက်နှာပြင်ပိတ်ထားချိန်တွင်လည်း live location ပို့နိုင်ရန် “Allow all the time” သို့မဟုတ် “Always” ကို ခွင့်ပြုပေးပါ။ Android 11 နှင့်အထက်တွင် Settings မှ ခွင့်ပြုရနိုင်ပါသည်။'
    : status === 'services-required'
      ? 'ဖုန်း Settings ထဲတွင် Location ကို ဖွင့်ပြီး ပြန်စစ်ပါ။ Location မဖွင့်ထားသရွေ့ app ထဲသို့ ဆက်မဝင်နိုင်ပါ။'
      : status === 'error'
        ? errorMessage || 'တည်နေရာဝန်ဆောင်မှုကို စစ်ဆေးစဉ် အမှားတစ်ခု ဖြစ်ပွားခဲ့ပါသည်။'
        : 'အကောင့်နှင့် တည်နေရာခွင့်ပြုချက်ကို စစ်ဆေးနေပါသည်။';
  const buttonTitle = status === 'permission-required'
    ? canAskAgain ? 'Location ခွင့်ပြုမည်' : 'App Settings ဖွင့်မည်'
    : status === 'background-permission-required'
      ? canAskAgain ? 'နောက်ခံတည်နေရာ ခွင့်ပြုမည်' : 'App Settings ဖွင့်မည်'
    : status === 'services-required'
      ? Platform.OS === 'android' ? 'Location ဖွင့်မည်' : 'Settings ဖွင့်မည်'
      : status === 'error'
        ? 'ပြန်စစ်မည်'
        : '';
  const isChecking = status === 'checking-session' || status === 'checking-location';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={[styles.card, { backgroundColor: cardColor }]}>
        {isChecking ? (
          <ActivityIndicator size="large" color="#f97316" />
        ) : (
          <Ionicons
            name={status === 'permission-required' ? 'location-outline' : 'navigate-outline'}
            size={40}
            color="#f97316"
          />
        )}
        <Text style={[styles.title, { color: textColor }]}>{title}</Text>
        <Text style={[styles.description, { color: secondaryColor }]}>{description}</Text>
        {buttonTitle ? (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => void handleContinue()}
          >
            <Text style={styles.buttonText}>{buttonTitle}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    padding: 28,
    borderRadius: 20,
  },
  title: {
    marginTop: 18,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  button: {
    minHeight: 48,
    marginTop: 24,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#f97316',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
