'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { bootTiming } from '@/libs/bootTiming';
import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { setAppPainted, useAppReady } from '@/spa/atoms/app';
import { removeStaticLoadingScreen } from '@/spa/loadingScreen';

// first-write-wins: only the very first paint records the boot timing mark.
let firstPaintMarked = false;

// Pure hung-hydration backstop — NOT a "boot is slow, paint anyway" timer.
// `loadIdb` always signals `ready` from its `finally` (even on an IndexedDB
// error), so legitimate hydration — however large the cached partition —
// resolves `ready` on its own and releases the gate before this fires; the only
// thing it catches is IndexedDB never responding, where there is no cache to
// wait for. A short window (the former 1500ms) misfires on a heavy account whose
// hydration outruns it: the gate paints an EMPTY app before the cache is in the
// Map, and a consumer that subscribes to its key then is orphaned forever (SWR
// does not observe the later direct Map insert), so it waits for the network —
// the sustained cold-open skeleton. See `coldHydrationGate.integration.test.tsx`
// (BUG→FIX) and `libs/swr/coldHydrationRace.test.tsx`.
const HYDRATION_TIMEOUT = 8000;

/**
 * Blocks the first paint until the active scope's IndexedDB cache has hydrated,
 * so the app never flashes empty on cold boot — the static `loading-screen`
 * overlay and then `BootShell` cover exactly this window, and releasing here is
 * what signals `appPainted` to tear them down.
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
 * pollute a partition. The timeout is a pure hung-hydration backstop (see
 * `HYDRATION_TIMEOUT`): the gate otherwise waits for real `ready`, so a heavy
 * account pays a slightly longer loading-screen ONCE at boot and then every
 * agent/topic it opens is served straight from the fully-hydrated in-memory
 * cache — no per-topic skeleton, no layout shift.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const appReady = useAppReady();

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
    // Runs after `children` have committed, so the boot shell only tears down
    // once the real app is already in the DOM.
    setAppPainted(true);
  }, [released]);

  // Backstop for entries that mount no `BootShell` (the Electron popup window,
  // whose `popup.html` ships a z-index 99999 scrim with `pointer-events: auto`):
  // the shell normally owns this removal, so without a backstop the popup stays
  // dimmed AND swallows every click.
  //
  // `appReady` is part of the condition, not decoration. Hydration can finish
  // before initialization, and in that window `AppLayer` still renders null while
  // `resolveBootShellPhase` is `hidden` (it needs BOTH signals for `done`, and
  // the 200ms timer has not fired) — so the shell is not up either. Removing the
  // splash on `released` alone blanks the window until whichever lands first,
  // and the shell timer has been measured arriving 1153ms late on an Electron
  // cold boot. Gating on `appReady` means `AppLayer` is rendering the outlet, so
  // the route's own fallback is guaranteed to be on screen.
  useLayoutEffect(() => {
    if (!released || !appReady) return;

    removeStaticLoadingScreen();
  }, [released, appReady]);

  if (!released) return null;

  return <>{children}</>;
};

export default CacheHydrationGate;
