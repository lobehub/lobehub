import type {
  AppUpdateState,
  DeviceControlDeps,
  InstallAppUpdateResult,
} from '@lobechat/device-control';
import type { UpdaterState } from '@lobechat/electron-client-ipc';

/**
 * How long `installAppUpdate` waits before quitting: long enough for the RPC
 * response to leave over the gateway socket, which closes with the app.
 */
export const REMOTE_INSTALL_DELAY_MS = 1500;

/** The slice of `UpdaterManager` a remote update drives. */
export interface RemoteUpdaterTarget {
  checkForUpdatesOnRequest: () => void;
  getUpdaterState: () => UpdaterState;
  installNow: () => void;
}

interface RemoteAppUpdateOptions {
  currentVersion: string;
  /** False when this build can't update itself (dev builds). */
  enabled: boolean;
  getUpdater: () => Promise<RemoteUpdaterTarget>;
  /** Injectable for tests; defaults to `setTimeout`. */
  schedule?: (run: () => void, delayMs: number) => void;
}

/** Project the updater's local state onto the remote-update wire shape. */
export const toAppUpdateState = (state: UpdaterState, currentVersion: string): AppUpdateState => {
  const inFlight = state.stage === 'downloading' || state.stage === 'downloaded';

  return {
    currentVersion,
    stage: state.stage,
    // The updater keeps the last `updateInfo` after it settles; only a download
    // in flight or ready to install has a real target.
    ...(inFlight && state.updateInfo?.version ? { targetVersion: state.updateInfo.version } : {}),
    ...(state.stage === 'downloading' && state.progress
      ? { progress: Math.round(state.progress.percent) }
      : {}),
    ...(state.stage === 'error' && state.errorMessage ? { errorMessage: state.errorMessage } : {}),
  };
};

/**
 * The desktop's app-update handlers for the device-control RPC dispatcher, so
 * the web device page can update this app remotely: check (an available update
 * downloads on its own), poll progress, then restart into it.
 */
export const createRemoteAppUpdateDeps = ({
  currentVersion,
  enabled,
  getUpdater,
  schedule = (run, delayMs) => setTimeout(run, delayMs),
}: RemoteAppUpdateOptions): Required<
  Pick<DeviceControlDeps, 'checkAppUpdate' | 'getAppUpdateState' | 'installAppUpdate'>
> => {
  const unsupported: AppUpdateState = { currentVersion, stage: 'unsupported' };

  const getAppUpdateState = async (): Promise<AppUpdateState> => {
    if (!enabled) return unsupported;
    return toAppUpdateState((await getUpdater()).getUpdaterState(), currentVersion);
  };

  return {
    checkAppUpdate: async () => {
      if (!enabled) return unsupported;

      const updater = await getUpdater();
      // A downloaded update is already what the caller is after — checking
      // again would download it a second time.
      if (updater.getUpdaterState().stage !== 'downloaded') updater.checkForUpdatesOnRequest();

      return toAppUpdateState(updater.getUpdaterState(), currentVersion);
    },

    getAppUpdateState,

    installAppUpdate: async (): Promise<InstallAppUpdateResult> => {
      if (!enabled) throw new Error('This build cannot install updates');

      const updater = await getUpdater();
      const state = updater.getUpdaterState();
      const targetVersion = state.updateInfo?.version;
      if (state.stage !== 'downloaded' || !targetVersion)
        throw new Error('No downloaded update to install');

      schedule(() => updater.installNow(), REMOTE_INSTALL_DELAY_MS);
      return { targetVersion };
    },
  };
};
