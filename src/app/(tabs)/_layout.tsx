import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationAccessGate } from '../../components/location-access-gate';
import { useAppTheme } from '../../lib/theme-provider';

export default function TabLayout() {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  return React.createElement(
    LocationAccessGate,
    null,
    React.createElement(
      Tabs,
      {
        screenOptions: {
          headerShown: false,
          tabBarActiveTintColor: '#f97316',
          tabBarInactiveTintColor: isDark ? '#94a3b8' : '#94a3b8',
          tabBarStyle: {
            position: 'absolute',
            bottom: Platform.OS === 'web' ? 15 : insets.bottom,
            left: Platform.OS === 'web' ? '5%' : undefined,
            width: Platform.OS === 'web' ? '90%' : undefined,
            marginHorizontal: Platform.OS === 'web' ? 0 : '5%',
            flexDirection: 'row',
            elevation: 5,
            backgroundColor: isDark ? 'rgba(21, 28, 42, 0.98)' : 'rgba(255, 255, 255, 0.95)',
            borderColor: isDark ? '#2b3648' : 'transparent',
            borderRadius: 35,
            height: 60,
            paddingBottom: 4,
            borderTopWidth: 0,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.15,
            shadowRadius: 15,
          },
          tabBarItemStyle: {
            flex: 1,
            paddingVertical: Platform.OS === 'web' ? 4 : 5,
            alignItems: 'center',
            justifyContent: 'center',
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
          },
        },
      },
      React.createElement(Tabs.Screen, {
        name: 'index',
        options: {
          title: 'Home',
          tabBarIcon: ({ color, size }: { color: any; size: number }) =>
            React.createElement(Ionicons, { name: 'home-outline', size, color }),
        },
      }),
      React.createElement(Tabs.Screen, {
        name: 'ways',
        options: {
          title: 'Ways',
          tabBarIcon: ({ color, size }: { color: any; size: number }) =>
            React.createElement(Ionicons, { name: 'bicycle-outline', size, color }),
        },
      }),
      React.createElement(Tabs.Screen, {
        name: 'map',
        options: {
          title: 'Map',
          tabBarIcon: ({ color, size }: { color: any; size: number }) =>
            React.createElement(Ionicons, { name: 'map-outline', size, color }),
        },
      }),
      React.createElement(Tabs.Screen, {
        name: 'delivered',
        options: {
          title: 'Delivered',
          tabBarIcon: ({ color, size }: { color: any; size: number }) =>
            React.createElement(Ionicons, { name: 'bag-check-outline', size, color }),
        },
      }),
      React.createElement(Tabs.Screen, {
        name: 'more',
        options: {
          title: 'More',
          tabBarIcon: ({ color, size }: { color: any; size: number }) =>
            React.createElement(Ionicons, { name: 'grid-outline', size, color }),
        },
      })
    )
  );
}