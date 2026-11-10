import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';
import { useElectronStore } from '@/store/electron';
import { desktopStateSelectors } from '@/store/electron/selectors';

/**
 * Resolve the home directory of the machine that owns the repo, for
 * `deriveWorktreePath`. A remote device's home comes from the `homePath` it
 * reports — the same value the server derives from — and the local machine's
 * from the desktop app state. `prefetch` starts the remote read early (while
 * the worktree menu is open) so the create modal opens without waiting.
 * Resolves `undefined` when unknown, which derives the sibling-folder fallback,
 * matching the server for a device that does not report its home.
 */
export const useWorktreeHomeDir = (deviceId?: string, prefetch = false) => {
  const workspaceId = useActiveWorkspaceId();
  const { data } = useClientDataSWR(
    deviceId && prefetch ? deviceKeys.systemInfo(workspaceId, deviceId) : null,
    () => deviceService.getDeviceSystemInfo({ deviceId: deviceId! }),
    { revalidateOnFocus: false },
  );

  return useCallback(async (): Promise<string | undefined> => {
    if (!deviceId)
      return desktopStateSelectors.userHomePath(useElectronStore.getState()) || undefined;
    if (data) return data.homePath || undefined;
    // An unreachable device can't create a worktree either; the sibling
    // fallback only shapes the preview until the create call reports why.
    const info = await deviceService.getDeviceSystemInfo({ deviceId }).catch(() => undefined);
    return info?.homePath || undefined;
  }, [data, deviceId]);
};
