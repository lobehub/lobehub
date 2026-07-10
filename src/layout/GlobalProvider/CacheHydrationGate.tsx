'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { bootTiming } from '@/libs/bootTiming';
import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';

// first-write-wins: only the very first paint records the boot timing mark.
let firstPaintMarked = false;

const HYDRATION_TIMEOUT = 1500;

/**
 * Blocks the first paint until the active scope's IndexedDB cache has hydrated,
 * so the app never flashes empty on cold boot — the static `loading-screen`
 * overlay covers exactly this window.
 *
 * This is a one-way latch: once released it never blanks again. A later scope
 * change (anonymous → signed-in, or workspace switch) re-hydrates the SWR cache
 * *in place* via `Query.tsx`'s `reloadScope()`, keeping the current tree mounted
 * while the new scope's data swaps in underneath.
 *
 * The active scope is known synchronously at boot from the persisted
 * `activeScopeKey` (the last-known `${userId}:${workspace}`), so the provider
 * hydrates the *real* user partition in parallel with the session check — the
 * gate only waits for that hydration (`ready`), not for the identity
 * round-trip. That parallelism is what restores instant-from-cache first paint.
 * Writes made before the session confirms the scope are quarantined by the
 * cache provider (`isEphemeralScope`), so the optimistic window can't orphan or
 * pollute a partition. The 1500ms timeout is a pure hung-hydration backstop.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();

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
    // Release the moment the active scope's cache has hydrated — the persisted
    // activeScopeKey means that's already the real user partition, so this paints
    // straight from cache. The timeout backstop guards a hung hydration only.
    if (ready || timedOut) setReleased(true);
  }, [ready, timedOut, released]);

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
