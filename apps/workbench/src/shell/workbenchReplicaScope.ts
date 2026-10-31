import { useLayoutEffect, useSyncExternalStore } from 'react';

import { type ReplicaScopeSource } from '@/libs/replica';
import { broadcastCacheScope } from '@/libs/replica/cacheScopeEvents';
import {
  buildCacheScope,
  clearActiveScopeKey,
  isAnonymousScope,
  readActiveScope,
  writeActiveScope,
} from '@/libs/swr/useCacheScope';

/**
 * Workbench replica partition: `${userId}:workbench`.
 *
 * Workbench never mounts the user store or the workspace store, so it cannot
 * resolve the main SPA's `${userId}:${workspaceId}` scope. Its own partition
 * keeps what it persists apart from every main-SPA partition, while the user
 * part still isolates accounts sharing the browser.
 *
 * Public surfaces (acceptance / verify) stay network-only. A private route
 * calls `enableWorkbenchIdentity()`, which runs the same contract as the main
 * SPA: paint the last-known user's partition while the session check is in
 * flight, switch (and drop the painted rows) if the session belongs to someone
 * else or to nobody, and persist only after the session is confirmed.
 */
const WORKBENCH_PARTITION = 'workbench';

type Identity = { status: 'unresolved' } | { status: 'resolved'; userId: string | null };

let identity: Identity = { status: 'unresolved' };
let identityEnabled = false;
let sessionCheck: Promise<void> | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/**
 * The last user the main SPA confirmed. The main SPA clears it on a sign-out it
 * observes, so a logged-out browser never guesses a previous account.
 */
const lastKnownUserId = (): string | null => {
  const scope = readActiveScope();
  if (!scope || isAnonymousScope(scope)) return null;

  return scope.split(':', 1)[0] || null;
};

const currentUserId = (): string | null =>
  identity.status === 'resolved' ? identity.userId : identityEnabled ? lastKnownUserId() : null;

const getScope = (): string => buildCacheScope(currentUserId(), WORKBENCH_PARTITION);

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const useWorkbenchCacheScope = (): string => {
  const scope = useSyncExternalStore(subscribe, getScope, getScope);

  // Before paint, like `useCacheScope`: imperative replicas drop the previous
  // identity's views in the same frame the switch commits.
  useLayoutEffect(() => {
    broadcastCacheScope(scope);
  }, [scope]);

  return scope;
};

export const workbenchReplicaScope: ReplicaScopeSource = {
  canHydrate: () => identityEnabled,
  canPersist: () => identityEnabled && identity.status === 'resolved' && !!identity.userId,
  get: getScope,
  use: useWorkbenchCacheScope,
};

const resolveIdentity = (userId: string | null) => {
  const guessed = lastKnownUserId();
  identity = { status: 'resolved', userId };

  // Keep the shared last-known scope honest, as the main SPA would: a confirmed
  // sign-out drops it, and another account replaces it so the next boot of
  // either runtime does not paint the previous account first. The same account
  // keeps the main SPA's workspace part untouched.
  if (!userId) clearActiveScopeKey();
  else if (guessed !== userId) writeActiveScope(buildCacheScope(userId, null));

  emit();
};

const fetchSessionUserId = async (): Promise<string | null | undefined> => {
  const response = await fetch('/api/auth/get-session', { credentials: 'include' });
  if (response.status === 401) return null;
  // A transport or server failure is not evidence of sign-out: stay unresolved,
  // so nothing persists and the painted partition is only a guess.
  if (!response.ok) return undefined;

  const session = (await response.json()) as { user?: { id?: string } } | null;

  return session?.user?.id ?? null;
};

/**
 * Turn on persisted hydration for a private Workbench route and start its
 * session check. Call it while the route module loads, before the route renders,
 * so the very first sync of that route may paint from disk.
 */
export const enableWorkbenchIdentity = (): Promise<void> => {
  if (!identityEnabled) {
    identityEnabled = true;
    emit();
  }
  sessionCheck ??= fetchSessionUserId()
    .then((userId) => {
      if (userId !== undefined) resolveIdentity(userId);
    })
    .catch(() => {
      // Offline: keep painting the guess, persist nothing.
    });

  return sessionCheck;
};

/** Tests: back to a fresh, identity-less runtime. */
export const resetWorkbenchReplicaScope = (): void => {
  identity = { status: 'unresolved' };
  identityEnabled = false;
  sessionCheck = undefined;
  listeners.clear();
};
