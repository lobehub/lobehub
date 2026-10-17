// @vitest-environment happy-dom
import type { LoaderFunctionArgs, RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { contextListLoader } from './contextListLoader';
import { desktopRoutes } from './desktopRouter.config';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the userMemory store reached the entry
// chunk's first-screen graph.
vi.mock('@/routes/(main)/memory/contexts/contextsLoader', () => {
  loaderModule.evaluated = true;
  return { contextListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('context list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the context list on the desktop contexts route', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.path === 'contexts');

    expect(routes.length).toBeGreaterThan(0);

    expect(routes.map((r) => r.loader)).toEqual(routes.map(() => contextListLoader));
  });

  it('delegates to the real loader on first use', async () => {
    const { contextListLoader: realLoader } =
      await import('@/routes/(main)/memory/contexts/contextsLoader');

    const args = {
      request: new Request('https://app.lobehub.com/memory/contexts?q=foo'),
    } as LoaderFunctionArgs;

    await expect(contextListLoader(args)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
