'use client';

import { isDesktop } from '@lobechat/const';
import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { bootTiming } from '@/libs/bootTiming';
import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

// first-write-wins: only the very first paint records the boot timing mark.
let firstPaintMarked = false;

const HYDRATION_TIMEOUT = 1500;

/**
 * Blocks the first paint until the initial identity scope's IndexedDB cache has
 * hydrated, so the app never flashes empty on cold boot — the static
 * `loading-screen` overlay covers exactly this window.
 *
 * This is a one-way latch: once released it never blanks again. A later scope
 * change (anonymous → signed-in, or workspace switch) re-hydrates the SWR cache
 * *in place* via `Query.tsx`'s `reloadScope()`, keeping the current tree mounted
 * while the new scope's data swaps in underneath. Re-blocking here (as the old
 * `key={scope}` remount did) would unmount the whole app and expose a
 * full-screen white flash on login.
 *
 * On desktop the first paint additionally waits for `isUserStateInit` — the
 * `getUserState()` identity round-trip that populates `userId`. Without it the
 * cold boot would paint the anonymous scope first and then flip to the signed-in
 * scope, briefly flashing the logged-out shell. Anonymous desktop still resolves
 * (the round-trip completes with a null cloud `userId`), and the 1500ms timeout
 * is a hard backstop so a hung round-trip never keeps the app blank.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const isAuthLoaded = Boolean(useUserStore(authSelectors.isLoaded));
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);

  const ready = useSyncExternalStore(
    cacheHydration.subscribe,
    () => cacheHydration.isReady(scope),
    () => true,
  );

  const [released, setReleased] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Only the first hydration is time-boxed; after release the latch holds.
  useEffect(() => {
    if (released) return;
    const timer = setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, [released]);

  useEffect(() => {
    if (released) return;
    // Hard backstop: never stay blank past the timeout, whatever is pending.
    if (timedOut) {
      setReleased(true);
      return;
    }
    if (!isAuthLoaded) return;
    // Desktop paints against the final identity scope, not the anonymous one.
    if (isDesktop && !isUserStateInit) return;
    if (!ready) return;

    setReleased(true);
  }, [isAuthLoaded, isUserStateInit, ready, released, timedOut]);

  useLayoutEffect(() => {
    if (!released) return;

    if (!firstPaintMarked) {
      firstPaintMarked = true;
      bootTiming.mark('first-paint');
    }
    document.getElementById('loading-screen')?.remove();
  }, [released]);

  if (!released) return null;

  return <>{children}</>;
};

export default CacheHydrationGate;
