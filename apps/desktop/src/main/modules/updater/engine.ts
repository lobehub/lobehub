import type { ProgressInfo, UpdateInfo } from 'electron-updater';

export interface UpdateEngineEvents {
  'checking-for-update': [];
  'download-progress': [ProgressInfo];
  'error': [Error];
  'update-available': [UpdateInfo];
  'update-downloaded': [UpdateInfo];
  'update-not-available': [UpdateInfo];
}

export type UpdateEngineKind = 'electron-updater' | 'sparkle';

export interface UpdateEngine {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  installOnQuit: () => void;
  kind: UpdateEngineKind;
  on: <K extends keyof UpdateEngineEvents>(
    event: K,
    listener: (...args: UpdateEngineEvents[K]) => void,
  ) => void;
  quitAndInstall: () => void;
}
