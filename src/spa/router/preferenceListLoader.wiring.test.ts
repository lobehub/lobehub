// @vitest-environment happy-dom
import type { LoaderFunctionArgs, RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';
import { preferenceListLoader } from './preferenceListLoader';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the userMemory store reached the entry
// chunk's first-screen graph.
vi.mock('@/routes/(main)/memory/preferences/preferencesLoader', () => {
  loaderModule.evaluated = true;
  return { preferenceListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('preference list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the preference list on the desktop preferences route', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.path === 'preferences');

    expect(routes.length).toBeGreaterThan(0);

    expect(routes.map((r) => r.loader)).toEqual(routes.map(() => preferenceListLoader));
  });

  it('delegates to the real loader on first use', async () => {
    const { preferenceListLoader: realLoader } =
      await import('@/routes/(main)/memory/preferences/preferencesLoader');

    const args = {
      request: new Request('https://app.lobehub.com/memory/preferences?q=foo'),
    } as LoaderFunctionArgs;

    await expect(preferenceListLoader(args)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
