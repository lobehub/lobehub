import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { getUserStoreState, useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const ANON = 'anon';
const PERSONAL = 'personal';

/**
 * Build a cache scope string from the current identity.
 *
 * Every client-side persistence tier (the localStorage SWR cache and the
 * IndexedDB local-first store) is partitioned by this scope so that data
 * belonging to different users / workspaces sharing the same browser origin
 * never collides or overwrites each other.
 *
 * Personal mode (no active workspace) collapses to `${userId}:personal`;
 * logged-out / SSR collapses to `anon:personal`.
 */
export const buildCacheScope = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
): string => `${userId || ANON}:${workspaceId || PERSONAL}`;

/**
 * React hook returning the current cache scope. Recomputes when the signed-in
 * user or the active workspace changes.
 */
export const useCacheScope = (): string => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  return buildCacheScope(userId, workspaceId);
};

/**
 * Non-React getter for the current cache scope (for use inside services /
 * imperative code paths).
 */
export const getCacheScope = (): string =>
  buildCacheScope(userProfileSelectors.userId(getUserStoreState()), getActiveWorkspaceId());
