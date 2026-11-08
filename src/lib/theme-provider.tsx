import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Appearance, Platform, StyleSheet, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  ready: boolean;
  toggleTheme: () => Promise<void>;
};

const THEME_STORAGE_KEY = 'app-theme-mode';
const ThemeContext = createContext<ThemeContextValue | null>(null);

const darkBackgroundColors: Record<string, string> = {
  '#ffffff': '#151c2a',
  '#fff': '#151c2a',
  '#f8fafc': '#0b1220',
  '#f5f5f5': '#0b1220',
  '#fafafa': '#151c2a',
  '#f9fafb': '#111827',
  '#f3f4f6': '#202b3d',
  '#e5e7eb': '#2b3648',
  '#f1f5f9': '#202b3d',
  '#f0f0f3': '#151c2a',
  '#e0e1e6': '#293447',
  '#e2e8f0': '#202b3d',
  '#cbd5e1': '#334155',
  '#ffedd5': '#3b2a1b',
  '#fff7ed': '#3b2a1b',
  '#f0fdf4': '#173326',
  '#dcfce7': '#173326',
  '#fef2f2': '#3a2022',
  '#fee2e2': '#3a2022',
  '#e0f2fe': '#172b45',
  '#eff6ff': '#172b45',
  '#dbeafe': '#172b45',
  '#ea580c': '#ea580c',
  '#f97316': '#f97316',
};

const darkTextColors: Record<string, string> = {
  '#000000': '#f8fafc',
  '#000': '#f8fafc',
  '#0f172a': '#f1f5f9',
  '#1e293b': '#e2e8f0',
  '#334155': '#cbd5e1',
  '#333333': '#f1f5f9',
  '#60646c': '#cbd5e1',
  '#111827': '#f1f5f9',
  '#374151': '#cbd5e1',
  '#4b5563': '#cbd5e1',
  '#6b7280': '#a8b3c5',
  '#475569': '#cbd5e1',
  '#64748b': '#a8b3c5',
  '#666666': '#a8b3c5',
  '#94a3b8': '#94a3b8',
  '#0284c7': '#38bdf8',
  '#0369a1': '#38bdf8',
  '#ea580c': '#fb923c',
  '#f97316': '#fb923c',
  '#c2410c': '#fb923c',
  '#9a3412': '#fb923c',
  '#15803d': '#4ade80',
  '#166534': '#4ade80',
  '#16a34a': '#4ade80',
  '#b91c1c': '#f87171',
  '#dc2626': '#f87171',
  '#ef4444': '#f87171',
};

const darkBorderColors: Record<string, string> = {
  '#f1f5f9': '#263244',
  '#e2e8f0': '#2b3648',
  '#cbd5e1': '#3b475b',
  '#dddddd': '#3b475b',
  '#fed7aa': '#5a3b20',
  '#ffedd5': '#3b2a1b',
  '#f97316': '#ea580c',
  '#bbf7d0': '#24533d',
  '#fecaca': '#633238',
};

function darkenStyle(style: ViewStyle | TextStyle | ImageStyle) {
  const result = { ...style };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'string') continue;
    const normalized = value.toLowerCase();
    if (key === 'backgroundColor' || key === 'underlayColor') {
      (result as Record<string, unknown>)[key] =
        normalized.startsWith('rgba(255, 255, 255')
          ? 'rgba(21, 28, 42, 0.98)'
          : darkBackgroundColors[normalized] ?? value;
    } else if (key === 'borderColor' || key.startsWith('border') && key.endsWith('Color')) {
      (result as Record<string, unknown>)[key] = darkBorderColors[normalized] ?? darkBackgroundColors[normalized] ?? value;
    } else if (key === 'color') {
      (result as Record<string, unknown>)[key] = darkTextColors[normalized] ?? value;
    }
  }
  return result;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>(() =>
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((storedMode) => {
        if (!active) return;
        const initialMode = storedMode === 'dark' || storedMode === 'light'
          ? storedMode
          : Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
        setMode(initialMode);
        if (Platform.OS !== 'web') Appearance.setColorScheme(initialMode);
      })
      .catch((error: unknown) => {
        console.error('Could not load the saved theme preference:', error);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const themeColor = mode === 'dark' ? '#0b1220' : '#f8fafc';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute(
      'content',
      mode === 'dark' ? 'black' : 'default',
    );
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const toggleTheme = useCallback(async () => {
    if (!loaded) throw new Error('Theme preference is still loading.');
    const nextMode: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    await AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode);
    if (Platform.OS !== 'web') Appearance.setColorScheme(nextMode);
    setMode(nextMode);
  }, [loaded, mode]);

  const value = useMemo(
    () => ({
      mode,
      isDark: mode === 'dark',
      ready: loaded,
      toggleTheme,
    }),
    [loaded, mode, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useAppTheme must be used inside ThemeProvider.');
  return theme;
}

export function useThemeStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(styles: T): T {
  const { isDark } = useAppTheme();

  return useMemo(() => {
    if (!isDark) return styles;

    const themedStyles: Record<string, ViewStyle | TextStyle | ImageStyle> = {};
    for (const [name, style] of Object.entries(styles)) {
      const flattened = StyleSheet.flatten(style as StyleProp<ViewStyle | TextStyle | ImageStyle>) ?? {};
      themedStyles[name] = darkenStyle(flattened as ViewStyle | TextStyle | ImageStyle);
    }
    return themedStyles as T;
  }, [isDark, styles]);
}
