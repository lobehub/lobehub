import type { ProgressInfo, UpdateChannel, UpdateInfo, UpdaterState } from '../types';

export interface UpdateBroadcastEvents {
  coreUpdateApplied: (version: string) => void;
  coreUpdateDeferred: () => void;
  reloadConfirmationCancelled: () => void;
  reloadConfirmationRequested: () => void;
  updateChannelChanged: (channel: UpdateChannel) => void;
  updateDownloadProgress: (progress: ProgressInfo) => void;
  updateError: (message: string) => void;
  updateReady: (info: UpdateInfo) => void;
  updaterStateChanged: (state: UpdaterState) => void;
  updateWillInstallLater: () => void;
}
