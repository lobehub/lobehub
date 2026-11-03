import { useCallback } from 'react';

import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Whether the current user may manage (edit / delete / re-authorize) a
 * workspace-shared resource row. Mirrors the server-side
 * `assertWorkspaceRowManageable` rule: only the row's creator or a workspace
 * owner may mutate it.
 *
 * - Personal mode: every row is created by the current user, so the creator
 *   check passes naturally.
 * - Missing creator attribution (legacy rows / partial payloads): do not block
 *   the UI — the server still enforces.
 */
export const useResourceManageable = (creatorUserId?: string | null): boolean => {
  const checkManageable = useResourceManageableChecker();

  return checkManageable(creatorUserId);
};

/**
 * Callback variant of {@link useResourceManageable} for call sites that need to
 * evaluate multiple rows under a single hook call (e.g. table columns, list
 * item menus built in a loop).
 */
export const useResourceManageableChecker = (): ((creatorUserId?: string | null) => boolean) => {
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const isOwner = useIsWorkspaceOwner();

  return useCallback(
    (creatorUserId?: string | null) => {
      if (!creatorUserId) return true;
      return isOwner || creatorUserId === currentUserId;
    },
    [currentUserId, isOwner],
  );
};
