import type { DeviceListItem } from '@lobechat/types';
import { useCallback } from 'react';

import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Predicate for "can the current user mutate this device row?". Mirrors the
 * server-side `canEditWorkspaceDevice` gate (see
 * `apps/server/src/routers/lambda/device.ts`) so the UI only exposes
 * rename / remove / working-dir controls when the matching request would
 * actually succeed.
 *
 * Rules:
 *   - Personal devices belong solely to the caller → always editable.
 *   - Workspace devices are editable by any workspace owner, OR by the member
 *     whose `enrollerUserId` matches the current user. Ghost rows (no
 *     persisted enroller) are fail-closed for non-owners — there is no row to
 *     edit until the device auto-registers.
 */
export const useCanEditDevice = () => {
  const isOwner = useIsWorkspaceOwner();
  const currentUserId = useUserStore(userProfileSelectors.userId);

  return useCallback(
    (device: DeviceListItem): boolean => {
      if (device.scope === 'personal') return true;
      if (isOwner) return true;
      if (!device.enrollerUserId || !currentUserId) return false;
      return device.enrollerUserId === currentUserId;
    },
    [isOwner, currentUserId],
  );
};
