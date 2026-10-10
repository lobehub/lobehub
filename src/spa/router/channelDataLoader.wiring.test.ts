// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { channelDataLoader } from './channelDataLoader';
import { desktopRoutes } from './desktopRouter.config';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the agent store reached the entry chunk's
// first-screen graph.
vi.mock('@/routes/(main)/agent/channel/channelLoader', () => {
  loaderModule.evaluated = true;
  return { channelDataLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('channel data loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the channel data on both channel routes', () => {
    const channelRoutes = flatten(desktopRoutes).filter(
      (route) => route.path === 'channel' || route.path === 'channel/:platform',
    );

    // Both `channel` and `channel/:platform` carry it, in every route table copy.
    expect(new Set(channelRoutes.map((route) => route.path))).toEqual(
      new Set(['channel', 'channel/:platform']),
    );
    expect(channelRoutes.every((route) => route.loader === channelDataLoader)).toBe(true);
  });

  it('delegates to the real loader with the route args on first use', async () => {
    const { channelDataLoader: realLoader } =
      await import('@/routes/(main)/agent/channel/channelLoader');
    const args = { params: { aid: 'agt_1' } };

    await expect(channelDataLoader(args as never)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
