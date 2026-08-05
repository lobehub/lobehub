'use client';

import { use, useEffect } from 'react';
import { useLocation } from 'react-router';

import { useElectronStore } from '@/store/electron';

import { TabIdContext } from './TabIdContext';
import { getTabRouter } from './tabRouterManager';

const TabLocationReporter = () => {
  const tabId = use(TabIdContext);
  const location = useLocation();
  const reportTabLocation = useElectronStore((s) => s.reportTabLocation);

  useEffect(() => {
    if (!tabId) return;
    // `<Activity mode="hidden">` tears down effects in hidden trees, so only the
    // active tab reaches here; the active-id check is belt-and-braces.
    if (useElectronStore.getState().activeTabId !== tabId) return;

    // A hidden tree also loses `RouterProvider`'s subscription, and remounting it
    // only reconnects — it never replays what was missed. So a background
    // `navigateTab` leaves the router ahead of the tree it renders. Re-navigating
    // onto the router's own location pushes that state through instead of
    // reporting (and mirroring into the window url) a stale location.
    const router = getTabRouter(tabId);
    const routerLocation = router?.state.location;
    if (router && routerLocation && routerLocation.key !== location.key) {
      const { hash, pathname, search, state } = routerLocation;
      void router.navigate({ hash, pathname, search }, { replace: true, state });
      return;
    }

    reportTabLocation(tabId, location.pathname + location.search + location.hash);
  }, [tabId, location.key, location.pathname, location.search, location.hash, reportTabLocation]);

  return null;
};

export default TabLocationReporter;
