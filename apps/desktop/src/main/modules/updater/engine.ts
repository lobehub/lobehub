import type { ProgressInfo, UpdateChannel, UpdateInfo } from '@lobechat/electron-client-ipc';

type AppUpdateInfo = Omit<UpdateInfo, 'kind'>;

export interface UpdateEngineEvents {
  'checking-for-update': [];
  'download-progress': [ProgressInfo];
  'error': [Error];
  'update-available': [AppUpdateInfo];
  'update-downloaded': [AppUpdateInfo];
  'update-not-available': [AppUpdateInfo];
}

export type UpdateEngineKind = 'electron-updater' | 'sparkle';

export interface UpdateEngine {
  checkForUpdates: () => Promise<unknown>;
  configure: (channel: UpdateChannel) => void;
  downloadUpdate: () => Promise<unknown>;
  installOnQuit: () => void;
  /**
   * Whether this installation can update itself. electron-updater has no
   * updater for a snap, the plain `tar.gz` archive or an AppImage started
   * without its runtime, and silently resolves `checkForUpdates()` to `null`.
   */
  isActive: () => boolean;
  kind: UpdateEngineKind;
  on: <K extends keyof UpdateEngineEvents>(
    event: K,
    listener: (...args: UpdateEngineEvents[K]) => void,
  ) => void;
  quitAndInstall: () => void;
}

export const createUpdateEngine = async (_channel: UpdateChannel): Promise<UpdateEngine> =>
  (await import('./electronUpdaterEngine')).electronUpdaterEngine;
