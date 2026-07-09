import { useEffect, useState } from 'react';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { getUserStoreState, useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

const ANON = 'anon';
const PERSONAL = 'personal';

/**
 * localStorage key holding the last-known resolved cache scope
 * (`${userId}:${workspaceId}`). On a cold boot the identity round-trip hasn't
 * resolved yet, so we can't know which user partition to hydrate — reading this
 * synchronously lets us hydrate the *real* user's IndexedDB cache in parallel
 * with the session check, instead of the empty anonymous partition and only
 * re-hydrating after the session resolves. That parallelism is what restores
 * instant-from-cache first paint (the #10884 synchronous-cache behavior the
 * async IndexedDB tier in #15844 lost).
 */
const ACTIVE_SCOPE_STORAGE_KEY = 'lobehub:active-scope';

const isBrowser = () => typeof localStorage !== 'undefined';

const readActiveScope = (): string | null => {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(ACTIVE_SCOPE_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeActiveScope = (scope: string): void => {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(ACTIVE_SCOPE_STORAGE_KEY, scope);
  } catch {
    // best-effort
  }
};

/**
 * Drop the persisted active scope. Call on logout / sign-out so the next boot
 * doesn't hydrate a since-logged-out user's cache.
 */
export const clearActiveScopeKey = (): void => {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(ACTIVE_SCOPE_STORAGE_KEY);
  } catch {
    // best-effort
  }
};

/**
 * Build a cache scope string from the current identity.
 *
 * Every client-side persistence tier (the localStorage SWR cache and the
 * IndexedDB local-first store) is partitioned by this scope so that data
 * belonging to different users / workspaces sharing the same browser origin
 * never collides or overwrites each other.
 *
 * Personal mode (no active workspace) collapses to `${userId}:personal`;
 * logged-out / SSR / first-ever boot collapses to `anon:personal`.
 */
export const buildCacheScope = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
): string => `${userId || ANON}:${workspaceId || PERSONAL}`;

/**
 * Whether a scope belongs to the anonymous (identity-unresolved) partition.
 */
export const isAnonymousScope = (scope: string): boolean => scope.startsWith(`${ANON}:`);

/**
 * The effective cache scope for the *current* moment.
 *
 * - Identity resolved (`userId` known): the real scope `${userId}:${workspace}`.
 * - Identity unresolved (cold boot, session check in flight): the persisted
 *   `activeScopeKey` (last-known user) so the cache provider hydrates the right
 *   partition up front — falling back to `anon:personal` only on a first-ever
 *   boot with no persisted scope.
 */
const resolveScope = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  persisted: string | null,
): string => {
  if (userId) return buildCacheScope(userId, workspaceId);
  return persisted ?? buildCacheScope(undefined, undefined);
};

/**
 * React hook returning the current cache scope. Recomputes when the signed-in
 * user or the active workspace changes. Persists every resolved real (non-anon)
 * scope so the next cold boot can hydrate it in parallel with the session check.
 */
export const useCacheScope = (): string => {
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  // Read once on mount — the persisted key only matters before identity resolves.
  const [persisted] = useState(readActiveScope);

  const scope = resolveScope(userId, workspaceId, persisted);

  useEffect(() => {
    if (userId && !isAnonymousScope(scope)) writeActiveScope(scope);
  }, [scope, userId]);

  return scope;
};

/**
 * Non-React getter for the current cache scope (for use inside services /
 * imperative code paths, and the SWR cache provider's `getScope`).
 */
export const getCacheScope = (): string =>
  resolveScope(
    userProfileSelectors.userId(getUserStoreState()),
    getActiveWorkspaceId(),
    readActiveScope(),
  );

/**
 * Whether the current scope has been confirmed by a resolved session.
 *
 * Until the auth/session check completes, the scope is the optimistic persisted
 * one (or anon) — writes made then are quarantined (see the cache provider's
 * `isEphemeralScope`) so an account switch / first-ever boot can't pollute or
 * orphan a partition. Once the session resolves, writes persist normally (this
 * also covers no-auth: the session check completes to "not signed in", and the
 * anonymous scope is a legitimate durable context there).
 */
export const isScopeTrusted = (): boolean => Boolean(authSelectors.isLoaded(getUserStoreState()));
