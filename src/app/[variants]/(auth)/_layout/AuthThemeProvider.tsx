'use client';

import type { PropsWithChildren } from 'react';
import { createContext, memo, use, useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'theme';
const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

type AuthTheme = 'dark' | 'light' | 'system';
type ResolvedAuthTheme = 'dark' | 'light';

interface AuthThemeState {
  resolvedTheme: ResolvedAuthTheme;
  setTheme: (theme: AuthTheme) => void;
  theme: AuthTheme;
}

const AuthThemeContext = createContext<AuthThemeState | null>(null);

const isAuthTheme = (theme: string): theme is AuthTheme =>
  theme === 'dark' || theme === 'light' || theme === 'system';

const getSystemTheme = (): ResolvedAuthTheme =>
  window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? 'dark' : 'light';

const getResolvedTheme = (theme: AuthTheme): ResolvedAuthTheme =>
  theme === 'system' ? getSystemTheme() : theme;

export const AuthThemeProvider = memo<PropsWithChildren>(({ children }) => {
  const [theme, setThemeState] = useState<AuthTheme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAuthTheme>('light');

  const setTheme = useCallback((nextTheme: AuthTheme) => {
    setThemeState(nextTheme);
    try {
      localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch (error) {
      console.error('[AuthThemeProvider] Failed to persist theme', error);
    }
  }, []);

  useEffect(() => {
    let storedTheme: AuthTheme = 'system';

    try {
      const localTheme = localStorage.getItem(STORAGE_KEY);
      if (localTheme && isAuthTheme(localTheme)) {
        storedTheme = localTheme;
      }
    } catch (error) {
      console.error('[AuthThemeProvider] Failed to read stored theme', error);
    }

    setThemeState(storedTheme);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
    const updateTheme = () => {
      const nextResolvedTheme = getResolvedTheme(theme);
      setResolvedTheme(nextResolvedTheme);
      document.documentElement.setAttribute('data-theme', nextResolvedTheme);
    };

    updateTheme();

    if (theme !== 'system') return;

    mediaQuery.addEventListener('change', updateTheme);

    return () => {
      mediaQuery.removeEventListener('change', updateTheme);
    };
  }, [theme]);

  const value = useMemo<AuthThemeState>(
    () => ({
      resolvedTheme,
      setTheme,
      theme,
    }),
    [resolvedTheme, setTheme, theme],
  );

  return <AuthThemeContext value={value}>{children}</AuthThemeContext>;
});

AuthThemeProvider.displayName = 'AuthThemeProvider';

export const useAuthTheme = () => {
  const context = use(AuthThemeContext);

  if (!context) {
    throw new Error('Missing AuthThemeProvider');
  }

  return context;
};

export const useIsDarkInAuth = () => useAuthTheme().resolvedTheme === 'dark';
