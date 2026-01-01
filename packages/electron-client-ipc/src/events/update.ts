import { ProgressInfo, UpdateInfo } from '../types';

export interface AutoUpdateBroadcastEvents {
  manualUpdateAvailable: (info: UpdateInfo) => void;
  manualUpdateCheckStart: () => void;
  manualUpdateNotAvailable: (info: UpdateInfo) => void;
  updateDownloadProgress: (progress: ProgressInfo) => void;
  updateDownloadStart: () => void;
  updateDownloaded: (info: UpdateInfo) => void;
  updateError: (message: string) => void;
  updateWillInstallLater: () => void;
}
