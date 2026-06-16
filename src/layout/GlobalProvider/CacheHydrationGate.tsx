'use client';

import { type PropsWithChildren, useEffect, useLayoutEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Max time to wait for the IndexedDB cache tier before rendering anyway, so a
 * slow / hung IndexedDB (or auth) never blocks the app indefinitely.
 */
const HYDRATION_TIMEOUT = 1500;

/**
 * Boot hydration gate.
 *
 * Holds the routed app until the *current identity scope's* IndexedDB cache
 * tier has hydrated, so local-first data (messages, topics, …) is present in
 * the SWR cache synchronously by the time components mount — including on a
 * deep-link cold load.
 *
 * While booting it renders nothing and lets the static HTML `#loading-screen`
 * (a fixed, top-most overlay defined in index.html) stay visible, then removes
 * it in the same layout pass that mounts the children. That keeps the boot a
 * single continuous loading screen — static loader → app — with no second
 * in-React logo and no flash.
 *
 * We deliberately gate through the pre-auth (anon) phase too: before auth
 * resolves the scope is `anon:*`, and un-gating there would paint the app for a
 * frame before auth flips the scope to the signed-in one and re-hydration kicks
 * in — the old `app → logo → app` flicker. Waiting on `isAuthLoaded && ready`
 * collapses that into one uninterrupted loader.
 */
const CacheHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const isAuthLoaded = useUserStore(authSelectors.isLoaded);

  const ready = useSyncExternalStore(
    cacheHydration.subscribe,
    () => cacheHydration.isReady(scope),
    () => true, // SSR: nothing to hydrate
  );

  // Safety valve: never block longer than HYDRATION_TIMEOUT, even if auth or
  // IndexedDB hangs. A single boot-level timer (the workspace remount keyed on
  // activeWorkspaceId gives a fresh gate — and timer — when the scope changes).
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, []);

  const booting = !(isAuthLoaded && ready) && !timedOut;

  // Hand off from the static loader to the app in one layout pass: children are
  // already committed to the DOM by the time this runs, so removing the loader
  // here (before paint) reveals the app with no intermediate blank/logo frame.
  useLayoutEffect(() => {
    if (booting) return;
    document.getElementById('loading-screen')?.remove();
  }, [booting]);

  if (booting) return null;

  return <>{children}</>;
};

export default CacheHydrationGate;
