// @vitest-environment happy-dom
import { matchRoutes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { agentUsageLoader } from './agentUsageLoader';
import { desktopRoutes } from './desktopRouter.config';
import { mobileRoutes } from './mobileRouter.config';
import { settingsTabLoader, statsPageLoader } from './statsPageLoader';

const loaderModules = vi.hoisted(() => ({ evaluated: [] as string[] }));

// Evaluating a real loader means the stats store reached the entry chunk's
// first-screen graph.
vi.mock('@/routes/(main)/settings/statsPageLoader', () => {
  loaderModules.evaluated.push('stats');
  return { statsPageLoader: vi.fn(async () => null) };
});
vi.mock('@/routes/(main)/agent/statistics/agentUsageLoader', () => {
  loaderModules.evaluated.push('agentUsage');
  return { agentUsageLoader: vi.fn(async () => null) };
});

/** The loader of the route that renders `pathname` (the deepest match). */
const leafLoader = (routes: Parameters<typeof matchRoutes>[0], pathname: string) =>
  matchRoutes(routes, pathname)?.at(-1)?.route.loader;

describe('stats loader wiring', () => {
  it('does not load the store-backed loaders while the route tables load', () => {
    expect(loaderModules.evaluated).toEqual([]);
  });

  it('pre-hydrates the stats tab on the route that renders it', () => {
    expect(leafLoader(desktopRoutes, '/settings/stats')).toBe(settingsTabLoader);
    // Mobile renders `/settings/stats` from a static `stats` segment, which
    // outranks `:tab` and carries no `tab` param.
    expect(leafLoader(mobileRoutes, '/settings/stats')).toBe(statsPageLoader);
  });

  it('pre-hydrates an agent usage tab', () => {
    expect(leafLoader(desktopRoutes, '/agent/agt_1/statistics')).toBe(agentUsageLoader);
  });
});
