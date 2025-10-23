import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useTheme } from 'antd-style';
import { rgba } from 'polished';
import { useEffect } from 'react';

import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

export const useWatchThemeUpdate = () => {
  const [isAppStateInit, systemAppearance, updateElectronAppState, isMac] = useElectronStore(
    (s) => [
      s.isAppStateInit,
      s.appState.systemAppearance,
      s.updateElectronAppState,
      s.appState.isMac,
    ],
  );
  const [switchThemeMode, switchLocale] = useGlobalStore((s) => [
    s.switchThemeMode,
    s.switchLocale,
  ]);

  const theme = useTheme();

  useWatchBroadcast('themeChanged', ({ themeMode }) => {
    switchThemeMode(themeMode, { skipBroadcast: true });
  });

  useWatchBroadcast('localeChanged', ({ locale }) => {
    switchLocale(locale as any, { skipBroadcast: true });
  });

  useWatchBroadcast('systemThemeChanged', ({ themeMode }) => {
    updateElectronAppState({ systemAppearance: themeMode });
  });

  useEffect(() => {
    if (!isAppStateInit || !isMac) return;
    document.documentElement.style.background = 'none';

    // https://x.com/alanblogsooo/status/1939208908993896684
    const isNotSameTheme = !systemAppearance ? true : theme.appearance !== systemAppearance;

    document.body.style.background = rgba(theme.colorBgLayout, isNotSameTheme ? 0.95 : 0.66);
  }, [theme, systemAppearance, isAppStateInit, isMac]);
};
