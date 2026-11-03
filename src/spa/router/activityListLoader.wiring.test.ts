// @vitest-environment happy-dom
import type { LoaderFunctionArgs, RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { activityListLoader } from './activityListLoader';
import { desktopRoutes } from './desktopRouter.config';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the userMemory store reached the entry
// chunk's first-screen graph.
vi.mock('@/routes/(main)/memory/activities/activitiesLoader', () => {
  loaderModule.evaluated = true;
  return { activityListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('activity list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the activity list on the desktop activities route', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.path === 'activities');

    expect(routes.length).toBeGreaterThan(0);

    expect(routes.map((r) => r.loader)).toEqual(routes.map(() => activityListLoader));
  });

  it('delegates to the real loader on first use', async () => {
    const { activityListLoader: realLoader } =
      await import('@/routes/(main)/memory/activities/activitiesLoader');

    const args = {
      request: new Request('https://app.lobehub.com/memory/activities?q=foo'),
    } as LoaderFunctionArgs;

    await expect(activityListLoader(args)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
