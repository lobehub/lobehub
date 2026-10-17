// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';
import { pageListLoader } from './pageListLoader';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the page store reached the entry chunk's
// first-screen graph.
vi.mock('@/routes/(main)/page/pageListLoader', () => {
  loaderModule.evaluated = true;
  return { pageListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('page list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the page list on the desktop page layout route', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.path === 'page' && r.children?.length);

    expect(routes.length).toBeGreaterThan(0);

    expect(routes.map((r) => r.loader)).toEqual(routes.map(() => pageListLoader));
  });

  it('delegates to the real loader on first use', async () => {
    const { pageListLoader: realLoader } = await import('@/routes/(main)/page/pageListLoader');

    await expect(pageListLoader()).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalled();
  });
});
