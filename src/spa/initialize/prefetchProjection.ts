import { matchRoutes, type RouteObject } from 'react-router';

import { resolveTabScope } from '@/features/Electron/titlebar/TabBar/scope';
import { getTabPages } from '@/features/Electron/titlebar/TabBar/storage';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { type ProjectionPrefetch, projectionPrefetch, runProjectionPrefetch } from '@/projection';
import { homeSidebarViewContract } from '@/projection/modules/home/contracts';
import { getRoutePrefetchFromHandle } from '@/spa/router/routeMeta';

/**
 * Tier 0: the shell. Present on every route, so it never waits for a match.
 *
 * Mounting a surface is the last thing a boot does, so a read started there can
 * only land after the skeleton is gone — the list renders its own loading state
 * for one IPC round trip even though the rows were on disk the whole time.
 * Started here, the read normally lands before first paint.
 *
 * A miss is ordinary: an untrusted scope, an empty cache, or a Web build with
 * no durable tier all resolve to a no-op, and the mounted view still requests
 * its own hydration.
 */
const shellPrefetch = (): ProjectionPrefetch[] => [projectionPrefetch(homeSidebarViewContract, {})];

export const prefetchShellProjection = (): Promise<void> =>
  runProjectionPrefetch(getCacheScope(), shellPrefetch());

/**
 * The url this boot will actually land on. Electron restores the last active
 * tab into a per-tab memory router, so `location` describes the window, not the
 * surface — the tab store is still empty this early, but its localStorage
 * record is not.
 */
export const resolveBootUrl = (): string => {
  const windowUrl = `${window.location.pathname}${window.location.search}`;
  const { activeTabId, tabs } = getTabPages(resolveTabScope(window.location.pathname));
  return tabs.find((tab) => tab.id === activeTabId)?.url ?? windowUrl;
};

/**
 * Tier 1: the landing surface, queued behind the shell rather than beside it.
 * Local reads are sub-millisecond but the desktop main process serializes the
 * IPC that carries them, so an unordered flood would delay the shell the user
 * sees first. Re-entering tier 0 here is free: an in-flight view is deduped and
 * a settled one has nothing left to request.
 */
export const prefetchRouteProjection = (routes: RouteObject[], url = resolveBootUrl()): void => {
  const requests = (matchRoutes(routes, url) ?? []).flatMap((match) => {
    const prefetch = getRoutePrefetchFromHandle(match.route.handle);
    return prefetch ? prefetch(match.params) : [];
  });
  if (requests.length === 0) return;

  void prefetchShellProjection().then(() => runProjectionPrefetch(getCacheScope(), requests));
};
