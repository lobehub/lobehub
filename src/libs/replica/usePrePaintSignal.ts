import { useLayoutEffect } from 'react';

import { bootTiming } from '@/libs/bootTiming';
import { setAppPainted, useAppReady } from '@/spa/atoms/app';
import { removeStaticLoadingScreen } from '@/spa/loadingScreen';

// first-write-wins: only the very first paint records the boot timing mark.
let firstPaintMarked = false;

/**
 * Signals the app's first paint to the boot shell. Call it from the component
 * that wraps the app tree: layout effects run after the children's, so the
 * signals fire once the app is in the DOM.
 *
 * Nothing is awaited here: server data the UI paints lives in replicas, and
 * each route loader hydrates its replica before the route renders (bounded by
 * `PRE_PAINT_HYDRATE_TIMEOUT`, see `./prePaint`). By the time the tree commits,
 * the first screen is already drawn from the local projection, so this only
 * reports that commit:
 *
 * - `first-paint` boot timing mark and `appPainted`, so `BootShell` tears down
 *   over a rendered app;
 * - removal of the static `loading-screen` once `appReady` is set as well.
 *   Entries that mount no `BootShell` (the Electron popup, whose `popup.html`
 *   ships a click-swallowing scrim) rely on this. Before `appReady`,
 *   `AppLayer` still renders null and the shell may be hidden, so removing
 *   the splash earlier would blank the window.
 */
export const usePrePaintSignal = (): void => {
  const appReady = useAppReady();

  useLayoutEffect(() => {
    if (!firstPaintMarked) {
      firstPaintMarked = true;
      bootTiming.mark('first-paint');
    }
    setAppPainted(true);
  }, []);

  useLayoutEffect(() => {
    if (!appReady) return;

    removeStaticLoadingScreen();
  }, [appReady]);
};
