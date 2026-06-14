'use client';

import { type PropsWithChildren, useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Max time to wait for the IndexedDB cache tier before rendering anyway, so a
 * slow / hung IndexedDB never blocks the app indefinitely.
 */
const HYDRATION_TIMEOUT = 1500;

/**
 * Boot hydration gate.
 *
 * Holds the routed app until the *current identity scope's* IndexedDB cache
 * tier has hydrated, so local-first data (messages, topics, …) is present in
 * the SWR cache synchronously by the time components mount — including on a
 * deep-link cold load. Before auth resolves the scope is `anon:*` (whose
 * IndexedDB tier is empty and resolves instantly), so this only ever waits the
 * few milliseconds an IndexedDB read takes for the signed-in scope.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const isAuthLoaded = useUserStore(authSelectors.isLoaded);

  const ready = useSyncExternalStore(
    cacheHydration.subscribe,
    () => cacheHydration.isReady(scope),
    () => true, // SSR: nothing to hydrate
  );

  // Safety valve: never block longer than HYDRATION_TIMEOUT.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) return;
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, [ready, scope]);

  // Only gate once auth has resolved (so we wait on the real scope, not anon).
  if (isAuthLoaded && !ready && !timedOut) return null;

  return <>{children}</>;
};

export default CacheHydrationGate;
