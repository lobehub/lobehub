'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode } from 'react';

interface NextThemeProviderProps {
  children: ReactNode;
}

export default function NextThemeProvider({ children }: NextThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
      forcedTheme={undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
