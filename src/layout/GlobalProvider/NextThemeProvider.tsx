'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode } from 'react';

interface NextThemeProviderProps {
  children: ReactNode;
}

export default function NextThemeProvider({ children }: NextThemeProviderProps) {
  return (
    <NextThemesProvider
      disableTransitionOnChange
      enableSystem
      attribute="data-theme"
      defaultTheme="system"
      forcedTheme={undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
