/**
 * Tracks which identity scopes have finished hydrating the IndexedDB SWR tier.
 */
interface CacheHydrationBlockState {
  isAuthLoaded: boolean;
  ready: boolean;
  released: boolean;
  scope: string;
  timedOutScope: string | null;
}

const readyScopes = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const markPending = (scope: string): void => {
  if (!readyScopes.delete(scope)) return;

  emit();
};

export const isCacheHydrationBlocked = ({
  isAuthLoaded,
  ready,
  released,
  scope,
  timedOutScope,
}: CacheHydrationBlockState) => {
  if (!released) return true;

  return !(isAuthLoaded && ready) && timedOutScope !== scope;
};

export const cacheHydration = {
  isReady: (scope: string): boolean => readyScopes.has(scope),

  markReady: (scope: string): void => {
    if (readyScopes.has(scope)) return;

    readyScopes.add(scope);
    emit();
  },

  markPending,

  reset: markPending,

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
