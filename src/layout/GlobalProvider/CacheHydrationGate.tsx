'use client';

import { isDesktop } from '@lobechat/const';
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
 * The first paint additionally waits for a real `userId` — but only where one
 * is expected, i.e. where the identity round-trip actually runs: normal desktop
 * app paths (which resolve a `DESKTOP_USER` id) or a signed-in web session. The
 * anonymous scope is only ever a transient pre-identity boot state, so painting
 * under it would persist fetched data into the `anon` partition and orphan it
 * the moment the real scope resolves (the stale-loading cache-miss bug).
 * Blocking until `userId` lands closes that leak at the root: no data UI ever
 * mounts under the anonymous scope. A no-auth / logged-out web deployment has
 * no `userId` to wait for, so it is exempt and falls through to the
 * timeout/ready backstop. `initState` revalidates on focus/reconnect, so a
 * transient network failure self-heals into a release.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const isAuthLoaded = Boolean(useUserStore(authSelectors.isLoaded));
  const isSignedIn = useUserStore(authSelectors.isLogin);
  const userId = useUserStore(userProfileSelectors.userId);
  const isDesktopOnboarding =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/desktop-onboarding');

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

    // A userId is expected only where the identity round-trip runs (desktop or a
    // signed-in web session — the same condition that triggers `useInitUserState`).
    // No-auth / logged-out web never produces one, so it must not be blocked here.
    // Guard on `isAuthLoaded` so we don't act on a stale `isSignedIn` mid-load.
    if (isAuthLoaded && ((isDesktop && !isDesktopOnboarding) || isSignedIn) && !userId) return;

    // Block until the session check resolves (it always does — success, failure,
    // or no-auth — so this isn't an infinite hang). Preceding the timeout means a
    // slow session can't release into the anonymous scope.
    if (!isAuthLoaded) return;

    // Backstop: identity resolved, but cache hydration is hung — release rather
    // than hang. Safe because a userId is either present or not expected here.
    if (timedOut) {
      setReleased(true);
      return;
    }
    if (!ready) return;

    setReleased(true);
  }, [isAuthLoaded, isDesktopOnboarding, isSignedIn, userId, ready, released, timedOut]);

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
