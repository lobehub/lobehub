import { type ElectronAppState } from '@lobechat/electron-client-ipc';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
// Import for type usage
import { electronSystemService } from '@/services/electron/system';
import { type LocaleMode } from '@/types/locale';
import { switchLang } from '@/utils/client/switchLang';
import { merge } from '@/utils/merge';

import type { ElectronStore } from '../store';

// ======== Action Interface ======== //

export interface ElectronAppAction {
  setConnectionDrawerOpen: (isOpen: boolean) => void;
  updateElectronAppState: (state: ElectronAppState) => void;

  /**
   * Initializes the basic Electron application state, including system info and special paths.
   * Should be called once when the application starts.
   */
  useInitElectronAppState: () => SWRResponse<ElectronAppState>;
}

// ======== Action Implementation ======== //

export const createElectronAppSlice: StateCreator<
  ElectronStore,
  [['zustand/devtools', never]],
  [],
  ElectronAppAction
> = (set, get) => ({
  setConnectionDrawerOpen: (isOpen: boolean) => {
    set({ isConnectionDrawerOpen: isOpen }, false, 'setConnectionDrawerOpen');
  },

  updateElectronAppState: (state: ElectronAppState) => {
    const prevState = get().appState;
    set({ appState: merge(prevState, state) });
  },

  useInitElectronAppState: () =>
    useOnlyFetchOnceSWR<ElectronAppState>(
      'initElectronAppState',
      async () => electronSystemService.getAppState(),
      {
        onSuccess: (result) => {
          set({ appState: result, isAppStateInit: true }, false, 'initElectronAppState');

          // Update the global agent context manager with relevant paths
          // We typically only need paths in the agent context for now.
          globalAgentContextManager.updateContext({
            desktopPath: result.userPath!.desktop,
            documentsPath: result.userPath!.documents,
            downloadsPath: result.userPath!.downloads,
            homePath: result.userPath!.home,
            musicPath: result.userPath!.music,
            picturesPath: result.userPath!.pictures,
            userDataPath: result.userPath!.userData,
            videosPath: result.userPath!.videos,
          });

          // Initialize i18n with the stored locale, falling back to auto detection.
          const locale = (result.locale ?? 'auto') as LocaleMode;
          switchLang(locale);
        },
      },
    ),
});
