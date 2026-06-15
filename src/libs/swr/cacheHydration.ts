/**
 * Cache hydration readiness store
 *
 * A tiny external store (consumable via `useSyncExternalStore`) that tracks
 * which identity scopes have finished hydrating their IndexedDB cache tier.
 *
 * The unified SWR cache provider marks a scope ready once its async IndexedDB
 * load completes; the boot `CacheHydrationGate` waits on this before mounting
 * the routed app, so local-first data (messages, topics, …) is present in the
 * cache synchronously by the time components mount — even on a deep-link cold
 * load. Decoupling through a module singleton lets the provider (high in the
 * tree) and the gate (around the routed children) communicate without prop or
 * context threading.
 */

const readyScopes = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const cacheHydration = {
  isReady: (scope: string): boolean => readyScopes.has(scope),

  /** Mark a scope's IndexedDB tier as hydrated. */
  markReady: (scope: string): void => {
    if (readyScopes.has(scope)) return;
    readyScopes.add(scope);
    emit();
  },

  /** Clear readiness for a scope (e.g. before re-hydrating on scope change). */
  reset: (scope: string): void => {
    if (!readyScopes.delete(scope)) return;
    emit();
  },

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
