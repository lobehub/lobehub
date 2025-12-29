import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { cssVar } from 'antd-style';
import { useLayoutEffect } from 'react';

import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { ensureElectronIpc } from '@/utils/electron/ipc';

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

  useWatchBroadcast('themeChanged', ({ themeMode }) => {
    switchThemeMode(themeMode, { skipBroadcast: true });
  });

  useWatchBroadcast('localeChanged', ({ locale }) => {
    switchLocale(locale as any, { skipBroadcast: true });
  });

  useWatchBroadcast('systemThemeChanged', ({ themeMode }) => {
    updateElectronAppState({ systemAppearance: themeMode });
  });
  const themeMode = useGlobalStore(systemStatusSelectors.themeMode);
  useLayoutEffect(() => {
    ensureElectronIpc().system.setSystemThemeMode(themeMode);
  }, []);

  useLayoutEffect(() => {
    if (!isAppStateInit || !isMac) return;
    document.documentElement.style.background = 'none';

    // https://x.com/alanblogsooo/status/1939208908993896684

    document.body.style.background = `color-mix(in srgb, ${cssVar.colorBgLayout} 66%, transparent)`;
  }, [systemAppearance, isAppStateInit, isMac]);
};
