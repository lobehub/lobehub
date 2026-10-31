// @vitest-environment happy-dom
import type { RouteObject } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';
import { scheduledTaskListLoader } from './scheduledTaskListLoader';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the task store reached the entry chunk's
// first-screen graph.
vi.mock('@/routes/(main)/tasks/scheduledTaskListLoader', () => {
  loaderModule.evaluated = true;
  return { scheduledTaskListLoader: vi.fn(async () => null) };
});

const flatten = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...(route.children ? flatten(route.children) : [])]);

describe('scheduled task list loader wiring', () => {
  it('does not load the store-backed loader while the route tables load', () => {
    expect(loaderModule.evaluated).toBe(false);
  });

  it('pre-hydrates the scheduled page on the global, agent and project Tasks routes', () => {
    const routes = flatten(desktopRoutes).filter((r) => r.loader === scheduledTaskListLoader);

    // Global `/tasks` (its index route) plus `/agent/:aid/tasks` and
    // `/project/:projectId/tasks`, under both the personal and workspace trees.
    expect(routes.filter((r) => r.index).length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.path === 'tasks').length).toBeGreaterThanOrEqual(2);
  });

  it('delegates to the real loader on first use', async () => {
    const { scheduledTaskListLoader: realLoader } =
      await import('@/routes/(main)/tasks/scheduledTaskListLoader');
    const args = { params: {}, request: new Request('http://localhost/tasks') } as any;

    await expect(scheduledTaskListLoader(args)).resolves.toBeNull();
    expect(realLoader).toHaveBeenCalledWith(args);
  });
});
