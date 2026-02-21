import { type ElectronAppState } from '@lobechat/electron-client-ipc';
import { type SWRResponse } from 'swr';

import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
// Import for type usage
import { electronSystemService } from '@/services/electron/system';
import { type StoreSetter } from '@/store/types';
import { type LocaleMode } from '@/types/locale';
import { switchLang } from '@/utils/client/switchLang';
import { merge } from '@/utils/merge';

import { type ElectronStore } from '../store';

// ======== Action Interface ======== //

// ======== Action Implementation ======== //

type Setter = StoreSetter<ElectronStore>;
export const createElectronAppSlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronAppActionImpl(set, get, _api);

export class ElectronAppActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  setConnectionDrawerOpen = (isOpen: boolean): void => {
    this.#set({ isConnectionDrawerOpen: isOpen }, false, 'setConnectionDrawerOpen');
  };

  updateElectronAppState = (state: ElectronAppState): void => {
    const prevState = this.#get().appState;
    this.#set({ appState: merge(prevState, state) });
  };

  useInitElectronAppState = (): SWRResponse<ElectronAppState> => {
    return useOnlyFetchOnceSWR<ElectronAppState>(
      'initElectronAppState',
      async () => electronSystemService.getAppState(),
      {
        onSuccess: (result) => {
          this.#set({ appState: result, isAppStateInit: true }, false, 'initElectronAppState');

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
    );
  };
}

export type ElectronAppAction = Pick<ElectronAppActionImpl, keyof ElectronAppActionImpl>;
