import { isDesktop } from '@lobechat/const';

import { getElectronStoreState } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

export const resolveArtboardFileBase = (base: string | null | undefined): string | null => {
  if (!base) return null;
  if (!isDesktop) return base;
  const origin = electronSyncSelectors.remoteServerUrl(getElectronStoreState()).replace(/\/+$/, '');
  return origin ? `${origin}${base}` : base;
};
