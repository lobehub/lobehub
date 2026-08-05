'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';

import { useElectronStore } from '@/store/electron';

/**
 * Hydrate the electron app state (default shell, user paths, locale) into the
 * electron store and the global agent context at boot, then keep it fresh via
 * the main process's `appStateUpdated` broadcast (e.g. when the user switches
 * the Windows shell in settings).
 *
 * Mounted from `StoreInitialization` on purpose: the previous init call lived
 * in `TitleBar` and was silently dropped in a titlebar refactor (#13059),
 * leaving `{{defaultShell}}` / path placeholders unresolved for months — keep
 * this with the other store initializers so layout changes can't detach it.
 */
const ElectronAppStateSync = () => {
  const [useInitElectronAppState, updateElectronAppState] = useElectronStore((s) => [
    s.useInitElectronAppState,
    s.updateElectronAppState,
  ]);

  useInitElectronAppState();

  useWatchBroadcast('appStateUpdated', (state) => {
    updateElectronAppState(state);
  });

  return null;
};

export default ElectronAppStateSync;
