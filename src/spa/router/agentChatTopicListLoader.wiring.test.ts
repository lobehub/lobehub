// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { agentRouteMeta } from '@/routes/(main)/agent/features/routeMeta';

import { agentChatTopicListLoader } from './agentChatTopicListLoader';
import { desktopRoutes } from './desktopRouter.config';
import { mobileRoutes } from './mobileRouter.config';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// The real loader imports the chat and agent stores. Recording its evaluation
// proves the route tables only reach it on first use: a static import from the
// router would pull both stores into the entry chunk's first-screen graph.
vi.mock('@/routes/(main)/agent/(chat)/topicListLoader', () => {
  loaderModule.evaluated = true;
  return { agentChatTopicListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

/**
 * The chat routes are the ones carrying the agent chat meta (index + `:topicId`);
 * every other agent sub-route (docs, goals, profile, …) has its own meta.
 */
const chatRoutes = (routes: RouteObject[]) =>
  flatten(routes).filter(
    (route) => (route.handle as { meta?: unknown } | undefined)?.meta === agentRouteMeta,
  );

// The hydration itself is covered elsewhere; this guards the wiring, which is the
// part a route-config refactor can silently drop — and dropping it looks exactly
// like the flash it was added to remove.
describe('agent chat topic list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the topic list on every desktop agent chat route', () => {
    const routes = chatRoutes(desktopRoutes);

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.map((route) => route.loader)).toEqual(routes.map(() => agentChatTopicListLoader));
  });

  it('pre-hydrates the topic list on the mobile agent chat routes too', () => {
    const routes = chatRoutes(mobileRoutes);

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.map((route) => route.loader)).toEqual(routes.map(() => agentChatTopicListLoader));
  });

  it('delegates to the real loader on first use', async () => {
    const { agentChatTopicListLoader: realLoader } =
      await import('@/routes/(main)/agent/(chat)/topicListLoader');
    const args = { params: { aid: 'agt_1' } } as any;

    await expect(agentChatTopicListLoader(args)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
