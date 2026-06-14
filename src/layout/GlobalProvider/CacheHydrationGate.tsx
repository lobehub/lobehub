'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';

import { ProductLogo } from '@/components/Branding';
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
  // While gating, mirror the boot loading screen (centered brand logo) rather
  // than blanking the page, so the hand-off from the static HTML loading screen
  // to the routed app stays seamless instead of flashing white.
  if (isAuthLoaded && !ready && !timedOut)
    return (
      <Flexbox height={'100%'} style={{ userSelect: 'none' }} width={'100%'}>
        <Center flex={1} gap={16} width={'100%'}>
          <ProductLogo size={48} type={'combine'} />
        </Center>
      </Flexbox>
    );

  return <>{children}</>;
};

export default CacheHydrationGate;
