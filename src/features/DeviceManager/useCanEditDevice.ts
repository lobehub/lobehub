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
 *   - Workspace ghost rows (gateway-only, not yet auto-registered → no
 *     persisted enroller) are fail-closed for everyone, owners included: the
 *     workspace update / remove mutations look the device up by id first and
 *     would throw NOT_FOUND, so exposing the controls only sets up a failing
 *     action. Wait for the row to materialise.
 *   - Workspace persisted rows are editable by any workspace owner, OR by the
 *     member whose `enrollerUserId` matches the current user.
 */
export const useCanEditDevice = () => {
  const isOwner = useIsWorkspaceOwner();
  const currentUserId = useUserStore(userProfileSelectors.userId);

  return useCallback(
    (device: DeviceListItem): boolean => {
      if (device.scope === 'personal') return true;
      if (!device.enroller) return false;
      if (isOwner) return true;
      if (!currentUserId) return false;
      return device.enroller.userId === currentUserId;
    },
    [isOwner, currentUserId],
  );
};
