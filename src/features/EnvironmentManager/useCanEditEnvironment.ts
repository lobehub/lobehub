import { useCallback } from 'react';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { SandboxEnvironment } from './useEnvironmentData';

/**
 * Can the caller mutate this environment's row?
 *
 * Mirrors the server's `environmentOwnership` filter exactly, so the UI only
 * offers rename / respecify / publish / delete where the matching request would
 * actually succeed. Creator-only, with no workspace-owner escalation — unlike
 * devices, because editing an environment rewrites what somebody else's next
 * instances are built from, and an owner has no way to know what that would
 * cost them.
 *
 * A published environment a colleague made is therefore readable and runnable,
 * but not editable. That is the whole shape of publishing one.
 */
export const useCanEditEnvironment = () => {
  const currentUserId = useUserStore(userProfileSelectors.userId);

  return useCallback(
    (environment: SandboxEnvironment): boolean => {
      // Personal environments have no other member to belong to.
      if (!environment.workspaceId) return true;
      if (!currentUserId) return false;

      return environment.userId === currentUserId;
    },
    [currentUserId],
  );
};
