import { type ElectronAppState } from '@lobechat/electron-client-ipc';
import { type SWRResponse } from 'swr';

import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
// Import for type usage
import { electronSystemService } from '@/services/electron/system';
import { type StoreSetter } from '@/store/types';
import { merge } from '@/utils/merge';

import { type ElectronStore } from '../store';

// ======== Action Interface ======== //

// ======== Action Implementation ======== //

type Setter = StoreSetter<ElectronStore>;
export const createElectronAppSlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronAppActionImpl(set, get, _api);

/**
 * Mirror app state into the global agent context so prompt placeholders
 * ({{defaultShell}}, {{homePath}}, ...) always describe the real desktop
 * environment. Every app-state write path (initial fetch and later
 * `appStateUpdated` broadcasts) must go through this — a prompt that
 * disagrees with the actual runCommand shell makes the model emit commands
 * for the wrong shell (e.g. PowerShell syntax into Git Bash).
 */
const syncAppStateToAgentContext = (state: ElectronAppState): void => {
  globalAgentContextManager.updateContext({
    ...(state.arch ? { arch: state.arch } : {}),
    ...(state.defaultShell ? { defaultShell: state.defaultShell } : {}),
    ...(state.userPath
      ? {
          desktopPath: state.userPath.desktop,
          documentsPath: state.userPath.documents,
          downloadsPath: state.userPath.downloads,
          homePath: state.userPath.home,
          musicPath: state.userPath.music,
          picturesPath: state.userPath.pictures,
          userDataPath: state.userPath.userData,
          videosPath: state.userPath.videos,
        }
      : {}),
  });
};

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
    syncAppStateToAgentContext(state);
  };

  useInitElectronAppState = (): SWRResponse<ElectronAppState> => {
    return useOnlyFetchOnceSWR<ElectronAppState>(
      'initElectronAppState',
      async () => electronSystemService.getAppState(),
      {
        onSuccess: (result) => {
          this.#set({ appState: result, isAppStateInit: true }, false, 'initElectronAppState');

          // Locale is intentionally NOT applied here anymore: the SPA boot flow
          // (SPAGlobalProvider's Locale) owns UI language now, and a second
          // switchLang from this once-dead init path would race it.
          syncAppStateToAgentContext(result);
        },
      },
    );
  };
}

export type ElectronAppAction = Pick<ElectronAppActionImpl, keyof ElectronAppActionImpl>;
