'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { bootTiming } from '@/libs/bootTiming';
import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

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
 * The first paint additionally waits for a real `userId` — the universal
 * "must be signed in" gate. The anonymous scope is only ever a transient
 * pre-identity boot state, so painting under it would persist fetched data into
 * the `anon` partition and orphan it the moment the real scope resolves (the
 * stale-loading cache-miss bug). Blocking until `userId` lands closes that leak
 * at the root: no data UI ever mounts under the anonymous scope. `initState`
 * revalidates on focus/reconnect, so a transient network failure self-heals
 * into a release; only a persistently-unreachable identity keeps the loading
 * screen up. The 1500ms timeout backstop only covers a *hung cache hydration*
 * after the identity has already resolved — it never releases into the
 * anonymous scope.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const isAuthLoaded = Boolean(useUserStore(authSelectors.isLoaded));
  const userId = useUserStore(userProfileSelectors.userId);

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

    // Universal identity gate: never paint until a real `userId` resolves. This
    // precedes the timeout backstop, so a slow or hung identity round-trip
    // keeps the loading screen up rather than releasing into the anonymous scope.
    if (!userId) return;

    // Backstop: identity resolved, but cache hydration is taking too long —
    // release rather than hang. Safe because `userId` is present here.
    if (timedOut) {
      setReleased(true);
      return;
    }
    if (!isAuthLoaded) return;
    if (!ready) return;

    setReleased(true);
  }, [userId, isAuthLoaded, ready, released, timedOut]);

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
