'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode } from 'react';

interface NextThemeProviderProps {
  children: ReactNode;
  forcedTheme?: 'dark' | 'light';
}

export default function NextThemeProvider({ children, forcedTheme }: NextThemeProviderProps) {
  return (
    <NextThemesProvider
      disableTransitionOnChange
      enableSystem
      attribute="data-theme"
      defaultTheme="system"
      forcedTheme={forcedTheme}
    >
      {children}
    </NextThemesProvider>
  );
}
