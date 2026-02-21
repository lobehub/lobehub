import type { ProgressInfo, UpdateInfo } from '../types';

export interface AutoUpdateBroadcastEvents {
  manualUpdateAvailable: (info: UpdateInfo) => void;
  manualUpdateCheckStart: () => void;
  manualUpdateNotAvailable: (info: UpdateInfo) => void;
  updateDownloaded: (info: UpdateInfo) => void;
  updateDownloadProgress: (progress: ProgressInfo) => void;
  updateDownloadStart: () => void;
  updateError: (message: string) => void;
  updateWillInstallLater: () => void;
}
