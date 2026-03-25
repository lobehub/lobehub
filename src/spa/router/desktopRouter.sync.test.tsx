import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';

import { desktopRoutes as desktopSyncRoutes } from './desktopRouter.config.desktop';
import { desktopRoutes as desktopAsyncRoutes } from './desktopRouter.config';

/**
 * Extract all route paths from a route tree for structural comparison.
 * Ignores element/errorElement (those differ by design: sync vs dynamic).
 */
function collectPaths(routes: RouteObject[], prefix = ''): string[] {
  const result: string[] = [];
  for (const route of routes) {
    const segment = route.path ?? (route.index ? '(index)' : '(pathless)');
    const full = `${prefix}/${segment}`.replaceAll('//', '/');
    result.push(full);
    if (route.children) {
      result.push(...collectPaths(route.children, full));
    }
  }
  return result;
}

/**
 * Known path pairs that intentionally differ between web and desktop (Electron).
 * Map: web path → desktop path
 */
const KNOWN_DIVERGENCES: Record<string, string> = {
  '/onboarding': '/desktop-onboarding',
};

function normalizePaths(paths: string[]): string[] {
  const webToDesktop = KNOWN_DIVERGENCES;
  const desktopToWeb = Object.fromEntries(
    Object.entries(webToDesktop).map(([w, d]) => [d, w]),
  );
  return paths.map((p) => desktopToWeb[p] ?? p);
}

describe('desktopRouter config sync', () => {
  it('desktop (sync) route paths must match web (async) route paths', () => {
    const asyncPaths = collectPaths(desktopAsyncRoutes).sort();
    const syncPaths = normalizePaths(collectPaths(desktopSyncRoutes)).sort();

    const missingInSync = asyncPaths.filter((p) => !syncPaths.includes(p));
    const extraInSync = syncPaths.filter((p) => !asyncPaths.includes(p));

    expect(missingInSync, `Missing in desktop config: ${missingInSync.join(', ')}`).toEqual([]);
    expect(extraInSync, `Extra in desktop config: ${extraInSync.join(', ')}`).toEqual([]);
  });
});
