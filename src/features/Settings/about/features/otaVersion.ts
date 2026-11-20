import type { CoreUpdateStatus } from '@lobechat/electron-client-ipc';

import { formatCoreVersion } from '@/features/Electron/updater/coreVersion';

export const getDisplayedOtaVersion = (status: CoreUpdateStatus | null): string | null =>
  status?.appliedVersion ?? status?.running ?? status?.current ?? null;

export const formatOtaVersionLabel = (version: string): string =>
  `OTA ${formatCoreVersion(version)}`;
