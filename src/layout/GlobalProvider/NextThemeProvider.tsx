'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ReactNode, useEffect } from 'react';

import { useEmbedForcedTheme } from '@/libs/agentEmbed/forcedTheme';
import { installFormAutocompleteDefaults } from '@/utils/client/installFormAutocompleteDefaults';

interface NextThemeProviderProps {
  children: ReactNode;
  forcedTheme?: 'dark' | 'light';
}

export default function NextThemeProvider({ children, forcedTheme }: NextThemeProviderProps) {
  useEffect(installFormAutocompleteDefaults, []);
  // An embedded conversation wears the host website's theme (see `forcedTheme.ts`).
  const embedTheme = useEmbedForcedTheme();

  return (
    <NextThemesProvider
      disableTransitionOnChange
      enableSystem
      attribute="data-theme"
      defaultTheme="system"
      forcedTheme={forcedTheme ?? embedTheme}
    >
      {children}
    </NextThemesProvider>
  );
}
