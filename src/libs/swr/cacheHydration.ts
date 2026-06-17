/**
 * Tracks which identity scopes have finished hydrating the IndexedDB SWR tier.
 */
const readyScopes = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const cacheHydration = {
  isReady: (scope: string): boolean => readyScopes.has(scope),

  markReady: (scope: string): void => {
    if (readyScopes.has(scope)) return;

    readyScopes.add(scope);
    emit();
  },

  reset: (scope: string): void => {
    if (!readyScopes.delete(scope)) return;

    emit();
  },

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
