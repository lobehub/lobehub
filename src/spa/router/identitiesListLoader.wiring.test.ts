// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';
import { identitiesListLoader } from './identitiesListLoader';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the userMemory store reached the entry
// chunk's first-screen graph.
vi.mock('@/routes/(main)/memory/identities/identitiesListLoader', () => {
  loaderModule.evaluated = true;
  return { identitiesListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('identities list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the identity list on the desktop identities route', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.path === 'identities');

    expect(routes.length).toBeGreaterThan(0);

    expect(routes.map((r) => r.loader)).toEqual(routes.map(() => identitiesListLoader));
  });

  it('delegates to the real loader on first use', async () => {
    const { identitiesListLoader: realLoader } =
      await import('@/routes/(main)/memory/identities/identitiesListLoader');

    await expect(identitiesListLoader()).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalled();
  });
});
