import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import '../lib/location-broadcast';
import { ThemeProvider, useAppTheme } from '../lib/theme-provider';

if (Platform.OS !== 'web') {
  void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
    console.error('Could not keep the splash screen visible:', error);
  });
}

function RootNavigator() {
  const {
    isDark,
    ready: themeReady,
  } = useAppTheme();
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const fontsReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (fontError) {
      console.error('Could not load icon fonts:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    if (Platform.OS === 'web' || !fontsReady || !themeReady) {
      return;
    }

    void SplashScreen.hideAsync().catch((error: unknown) => {
      console.error('Could not hide the splash screen:', error);
    });
  }, [fontsReady, themeReady]);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(StatusBar, { style: isDark ? 'light' : 'dark' }),
    React.createElement(
      Stack,
      {
        screenOptions: {
          headerShown: false,
          contentStyle: { backgroundColor: isDark ? '#0b1220' : '#f8fafc' },
        },
      },
      React.createElement(Stack.Screen, { name: '(tabs)' }),
      React.createElement(Stack.Screen, { name: 'completed-ways' }),
      React.createElement(Stack.Screen, { name: 'pickup-ways' }),
      React.createElement(Stack.Screen, { name: 'pickups' }),
      React.createElement(Stack.Screen, { name: 'completed-pickups' }),
      React.createElement(Stack.Screen, { name: 'pending-ways' }),
      React.createElement(Stack.Screen, { name: 'intake' }),
      React.createElement(Stack.Screen, { name: 'login' })
    )
  );
}

export default function RootLayout() {
  return React.createElement(ThemeProvider, null, React.createElement(RootNavigator));
}