'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { bootTiming } from '@/libs/bootTiming';
import { cacheHydration, isCacheHydrationBlocked } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

// first-write-wins: keyed by scope remounts must not overwrite the initial mark
let firstPaintMarked = false;

const HYDRATION_TIMEOUT = 1500;

const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();

  return (
    <CacheHydrationGateInner key={scope} scope={scope}>
      {children}
    </CacheHydrationGateInner>
  );
};

interface CacheHydrationGateInnerProps extends PropsWithChildren {
  scope: string;
}

const CacheHydrationGateInner = ({ children, scope }: CacheHydrationGateInnerProps) => {
  const isAuthLoaded = Boolean(useUserStore(authSelectors.isLoaded));

  const ready = useSyncExternalStore(
    cacheHydration.subscribe,
    () => cacheHydration.isReady(scope),
    () => true,
  );

  const [released, setReleased] = useState(false);
  const [timedOutScope, setTimedOutScope] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOutScope(scope), HYDRATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, [scope]);

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!cacheHydration.isReady(scope) && timedOutScope !== scope) return;

    setReleased(true);
  }, [isAuthLoaded, ready, scope, timedOutScope]);

  const booting = isCacheHydrationBlocked({
    isAuthLoaded,
    ready,
    released,
    scope,
    timedOutScope,
  });

  useLayoutEffect(() => {
    if (booting) return;

    if (!firstPaintMarked) {
      firstPaintMarked = true;
      bootTiming.mark('first-paint');
    }
    document.getElementById('loading-screen')?.remove();
  }, [booting]);

  if (booting) return null;

  return <>{children}</>;
};

export default CacheHydrationGate;
