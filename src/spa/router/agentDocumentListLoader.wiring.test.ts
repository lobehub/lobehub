// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { agentDocumentListLoader } from './agentDocumentListLoader';
import { desktopRoutes } from './desktopRouter.config';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the agent document store reached the entry
// chunk's first-screen graph.
vi.mock('@/routes/(main)/agent/docs/documentListLoader', () => {
  loaderModule.evaluated = true;
  return { agentDocumentListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('agent document list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the document list on the agent docs layout route', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.path === 'docs' && r.children?.length);

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.loader === agentDocumentListLoader)).toBe(true);
  });

  it('delegates to the real loader with the route args on first use', async () => {
    const { agentDocumentListLoader: realLoader } =
      await import('@/routes/(main)/agent/docs/documentListLoader');
    const args = { params: { aid: 'agt_1' } };

    await expect(agentDocumentListLoader(args as never)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
