import type { ProgressInfo, UpdateChannel, UpdateInfo, UpdaterState } from '../types';

export interface AutoUpdateBroadcastEvents {
  updateChannelChanged: (channel: UpdateChannel) => void;
  updateDownloaded: (info: UpdateInfo) => void;
  updateDownloadProgress: (progress: ProgressInfo) => void;
  updateError: (message: string) => void;
  updaterStateChanged: (state: UpdaterState) => void;
  updateWillInstallLater: () => void;
}
