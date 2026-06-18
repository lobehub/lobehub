import { isDesktop } from '@lobechat/const';
import { useEffect } from 'react';

import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import { getRecentDirs, RECENT_DIRS_KEY } from './recentDirs';

// Module-level guard: the migration is global, not per-component, so only the
// first mounted caller runs it per session (clearing localStorage makes it a
// no-op across reloads anyway).
let migrationStarted = false;

/**
 * One-time fold of the legacy localStorage recent dirs into this machine's
 * `device.workingDirs` (the unified recent source). Lives in the feature layer
 * because it reads/clears feature-owned localStorage; it passes the entries
 * *into* the device store action (store never imports feature storage). Runs
 * once the device store is populated and this machine's deviceId is known
 * (desktop only); keeps localStorage on a failed persist for a later retry.
 */
export const useMigrateDeviceRecents = (): void => {
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const isDevicesInit = useDeviceStore((s) => s.isDevicesInit);
  const migrate = useDeviceStore((s) => s.migrateLocalRecentsToDevice);

  useEffect(() => {
    if (migrationStarted || !isDesktop || !currentDeviceId || !isDevicesInit) return;

    const legacy = getRecentDirs();
    migrationStarted = true;
    if (legacy.length === 0) return;

    migrate(currentDeviceId, legacy)
      .then(() => localStorage.removeItem(RECENT_DIRS_KEY))
      .catch(() => {
        // Persist failed — keep localStorage so the next reload retries.
      });
  }, [currentDeviceId, isDevicesInit, migrate]);
};
