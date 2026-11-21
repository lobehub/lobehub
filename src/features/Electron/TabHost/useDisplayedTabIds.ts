import { useCallback, useState, useSyncExternalStore } from 'react';

import { type TabRouter } from './tabRouterManager';

interface UseDisplayedTabIdsOptions {
  canHold: boolean;
  existingTabIds: readonly string[];
  requestedRouters: readonly TabRouter[];
  requestedTabIds: string[];
}

const isSameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

// A cold tab router renders nothing until its first loaders settle (no
// HydrateFallback), and the route layout that registers the sidebar has not
// mounted yet. Showing it immediately blanks both the pane and the nav panel,
// so the previously displayed tab stays on screen until the new one is ready.
export const useDisplayedTabIds = ({
  canHold,
  existingTabIds,
  requestedRouters,
  requestedTabIds,
}: UseDisplayedTabIdsOptions): string[] => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribes = requestedRouters.map((router) => router.subscribe(onChange));
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    [requestedRouters],
  );
  const getReady = () => requestedRouters.every((router) => router.state.initialized);
  const isReady = useSyncExternalStore(subscribe, getReady, getReady);

  const [displayed, setDisplayed] = useState(requestedTabIds);
  const shouldHold =
    canHold &&
    !isReady &&
    displayed.length > 0 &&
    displayed.every((id) => existingTabIds.includes(id));

  if (!shouldHold && !isSameIds(displayed, requestedTabIds)) setDisplayed(requestedTabIds);

  return shouldHold ? displayed : requestedTabIds;
};
