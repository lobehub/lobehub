import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mainAreaMetaRoutes } from './desktopRouter.config.desktop';
import { getRouteMetaFromHandle, type RouteMeta } from './routeMeta';

// Params that pick a fixed section or view, not a record with a name of its own.
const VIEW_PARAMS = new Set([
  ':category',
  ':platform',
  ':section',
  ':sub',
  ':tab',
  ':workspaceSlug',
]);

// Leaves that never paint a page of their own: they redirect to the canonical URL.
const REDIRECT_PATHS = new Set([
  '/agent/:aid/self-evolving/:domainId/rules',
  '/agent/:aid/self-evolving/:domainId/rules/:lessonId',
  '/agent/:aid/self-learning/*',
  '/agent/:aid/stats',
  '/project/:projectId/conversation/:topicId?',
  '/settings/provider/:providerId',
]);

// Known gap: the eval workspace has no tab titles at all yet, static or dynamic.
const isEval = (path: string) => path.startsWith('/eval/');

interface Leaf {
  /** Retired URL that only redirects (`LEGACY_REDIRECT_HANDLE`). */
  legacyRedirect?: boolean;
  meta?: RouteMeta;
  path: string;
}

const collectLeaves = (routes: RouteObject[], prefix = '', inherited?: RouteMeta): Leaf[] =>
  routes.flatMap((route) => {
    const path = route.index ? prefix : `${prefix}/${route.path ?? ''}`.replaceAll(/\/+/g, '/');
    const meta = getRouteMetaFromHandle(route.handle) ?? inherited;
    if (route.children?.length) return collectLeaves(route.children, path, meta);
    const legacyRedirect = (route.handle as { legacyRedirect?: boolean } | undefined)
      ?.legacyRedirect;
    return [{ legacyRedirect, meta, path }];
  });

// A page that names a record ("this goal", "this agent's tasks") but registers no
// DynamicMeta is titled by its static label alone, so its tabs, Recent Pages and pinned
// pages all read "Goals", "Goals", "Goals".
describe('desktop route DynamicMeta registration', () => {
  const leaves = collectLeaves(mainAreaMetaRoutes)
    // Workspace-scoped mounts repeat the personal tree under `/:workspaceSlug`.
    .map((leaf) => ({ ...leaf, path: leaf.path.replace(/^\/:workspaceSlug(?=\/)/, '') }))
    .filter(
      ({ legacyRedirect, path }) => !legacyRedirect && !REDIRECT_PATHS.has(path) && !isEval(path),
    )
    .filter(({ path }) =>
      (path.match(/:\w+\??/g) ?? []).some((param) => !VIEW_PARAMS.has(param.replace('?', ''))),
    );

  it('collects record pages from the desktop meta tree', () => {
    expect(leaves.length).toBeGreaterThan(50);
  });

  it('gives every record page a DynamicMeta', () => {
    const missing = [
      ...new Set(leaves.filter(({ meta }) => !meta?.DynamicMeta).map((l) => l.path)),
    ];

    expect(missing).toEqual([]);
  });
});
