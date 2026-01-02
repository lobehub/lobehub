'use client';

import { useTheme as useNextThemesTheme } from 'next-themes';
import { useEffect } from 'react';

import { isDesktop } from '@/const/version';
import { ensureElectronIpc } from '@/utils/electron/ipc';

export const useWatchThemeFromNextThemes = () => {
  const { resolvedTheme } = useNextThemesTheme();

  useEffect(() => {
    if (!isDesktop) return;
    if (!resolvedTheme) return;

    const themeMode = resolvedTheme === 'dark' ? 'dark' : 'light';

    (async () => {
      try {
        await ensureElectronIpc().system.updateThemeModeHandler(themeMode);
      } catch {
        // Ignore errors in non-electron environment
      }
    })();
  }, [resolvedTheme]);
};
