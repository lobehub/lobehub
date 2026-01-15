import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { ensureElectronIpc } from '@/utils/electron/ipc';

export const useWatchThemeUpdate = () => {
  const [updateElectronAppState] = useElectronStore((s) => [s.updateElectronAppState]);
  const [switchLocale] = useGlobalStore((s) => [s.switchLocale]);

  useWatchBroadcast('localeChanged', ({ locale }) => {
    switchLocale(locale as any, { skipBroadcast: true });
  });

  useWatchBroadcast('systemThemeChanged', ({ themeMode }) => {
    updateElectronAppState({ systemAppearance: themeMode });
  });

  const { theme } = useTheme();

  useEffect(() => {
    if (!isDesktop) return;
    if (!theme) return;

    (async () => {
      try {
        await ensureElectronIpc().system.updateThemeModeHandler(
          theme as 'dark' | 'light' | 'system',
        );
      } catch {
        // Ignore errors in non-electron environment
      }
    })();
  }, [theme]);
};
