import type { CoreUpdateStatus } from '@lobechat/electron-client-ipc';

export const getDisplayedOtaVersion = (status: CoreUpdateStatus | null): string | null =>
  status?.running ?? status?.current ?? null;

export const formatOtaVersionLabel = (version: string): string =>
  `OTA ${version.replace('-core.', '-')}`;
