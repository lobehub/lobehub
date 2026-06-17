'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const HYDRATION_TIMEOUT = 1500;

const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const isAuthLoaded = useUserStore(authSelectors.isLoaded);

  const ready = useSyncExternalStore(
    cacheHydration.subscribe,
    () => cacheHydration.isReady(scope),
    () => true,
  );

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, []);

  const booting = !(isAuthLoaded && ready) && !timedOut;

  useLayoutEffect(() => {
    if (booting) return;

    document.getElementById('loading-screen')?.remove();
  }, [booting]);

  if (booting) return null;

  return <>{children}</>;
};

export default CacheHydrationGate;
