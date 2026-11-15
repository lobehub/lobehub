// @vitest-environment happy-dom
import type { LoaderFunctionArgs, RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';
import { memoryRulesLoader, selfLearningLoader } from './expertiseLoaders';

const loaderModules = vi.hoisted(() => ({ evaluated: [] as string[] }));

// Evaluating a real loader means the expertise store reached the entry chunk's
// first-screen graph.
vi.mock('@/routes/(main)/memory/rules/rulesLoader', () => {
  loaderModules.evaluated.push('rules');
  return { memoryRulesLoader: vi.fn(async () => null) };
});
vi.mock('@/routes/(main)/agent/self-learning/selfLearningLoader', () => {
  loaderModules.evaluated.push('selfLearning');
  return { selfLearningLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('expertise loader wiring', () => {
  it('does not load the store-backed loaders while the route tables load', () => {
    expect(loaderModules.evaluated).toEqual([]);
  });

  it('pre-hydrates the rule sheet on the My rules route', () => {
    const routes = flatten(desktopRoutes).filter(
      (r) => r.path === 'rules' && r.loader === memoryRulesLoader,
    );

    expect(routes.length).toBeGreaterThan(0);
  });

  it("pre-hydrates the agent's portrait on every Self-evolving portrait route", () => {
    const routes = flatten(desktopRoutes).filter(
      (r) => r.path === 'self-evolving' || r.path === 'self-evolving/:domainId',
    );

    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.map((r) => r.loader)).toEqual(routes.map(() => selfLearningLoader));
  });

  it('delegates to the real loaders on first use', async () => {
    const rules = await import('@/routes/(main)/memory/rules/rulesLoader');
    const selfLearning = await import('@/routes/(main)/agent/self-learning/selfLearningLoader');
    const args = { params: { aid: 'agent-1' } } as unknown as LoaderFunctionArgs;

    await expect(memoryRulesLoader()).resolves.toBeNull();
    await expect(selfLearningLoader(args)).resolves.toBeNull();
    expect(rules.memoryRulesLoader).toHaveBeenCalled();
    expect(selfLearning.selfLearningLoader).toHaveBeenCalledWith(args);
  });
});
