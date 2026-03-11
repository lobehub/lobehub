'use client';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

/**
 * Returns whether cloud sync is active (storage mode is cloud and sync is active).
 */
export const useIsCloudActive = () => {
  if (!isDesktop) return false;

  const storageMode = useElectronStore(electronSyncSelectors.storageMode);
  const isSyncActive = useElectronStore(electronSyncSelectors.isSyncActive);

  return storageMode === 'cloud' && isSyncActive;
};
