/**
 * Cache-scope change signal for the local-first replicas.
 *
 * Every client persistence tier is partitioned by the cache scope
 * (`${userId}:${workspace}`, see `@/libs/swr/useCacheScope`). A React consumer
 * observes a switch through `useCacheScope()`; a replica that lives in a
 * zustand store is not rendered by anything, so it sees nothing.
 *
 * `useSync`-driven replicas get this for free — the hook re-runs on a scope
 * switch and calls `ensureScope(newScope)` before paint. Imperative replicas
 * (the connector slice drives its fetches from legacy effects gated on an init
 * flag) have no such hook, so the engine would only notice the switch on its
 * *next dispatch*. Until then the previous identity's rows stay in the store's
 * view **and** keep its init flag set, which makes every gated consumer skip
 * the fetch for the new scope — the workspace then paints the previous user's
 * (or the personal) connector inventory until something unrelated happens to
 * dispatch.
 *
 * `useCacheScope` therefore broadcasts the new scope here, and imperative
 * replica owners subscribe to `ensureScope(scope)` the state those views are
 * derived from, so a switch drops the previous identity's memory immediately
 * instead of waiting for a dispatch that may never come.
 *
 * This module is deliberately dependency-free: `@/libs/replica/index` imports
 * `useCacheScope`, so `useCacheScope` must import this leaf file directly.
 */
type CacheScopeListener = (scope: string) => void;

const listeners = new Set<CacheScopeListener>();
let lastBroadcast: string | undefined;

/** Subscribe to cache-scope changes. Returns the unsubscribe. */
export const subscribeCacheScope = (listener: CacheScopeListener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/**
 * Announce that `scope` is now the active one. Idempotent: every mounted
 * `useCacheScope()` reports the same value, only the first is forwarded.
 */
export const broadcastCacheScope = (scope: string): void => {
  if (lastBroadcast === scope) return;
  lastBroadcast = scope;

  // Iterating the Set directly: a listener that unsubscribes mid-flight is
  // simply skipped, which is what the unsubscribe contract promises.
  for (const listener of listeners) listener(scope);
};

/** Forget the last broadcast value (tests: keeps cases independent). */
export const resetCacheScopeBroadcast = (): void => {
  lastBroadcast = undefined;
};
