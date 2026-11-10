import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { desktopRoutes as webRoutes } from '@/spa/router/desktopRouter.config';
import {
  desktopRoutes as electronRoutes,
  mainAreaMetaRoutes as electronMainAreaRoutes,
} from '@/spa/router/desktopRouter.config.desktop';
import { mobileRoutes } from '@/spa/router/mobileRouter.config';

import {
  OFF_TABLE_ROOT_SEGMENTS,
  parseRootSegment,
  RESERVED_ROOT_SEGMENTS,
  WORKSPACE_MIRRORED_ROOT_SEGMENTS,
} from './rootSegments';
import { isWorkspaceSlugCandidatePath } from './useWorkspaceUrlSync';

const NON_LITERAL = new Set([':workspaceSlug', '*']);

/** First literal segment of every route, descending through pathless layouts and `/`. */
const collectRootSegments = (routes: RouteObject[] = [], out = new Set<string>()) => {
  for (const route of routes) {
    if (route.index) continue;
    const path = route.path?.replace(/^\//, '') ?? '';
    if (!path) {
      collectRootSegments(route.children, out);
      continue;
    }
    const first = path.split('/')[0];
    if (!NON_LITERAL.has(first)) out.add(first);
  }
  return out;
};

const findWorkspaceRoutes = (routes: RouteObject[] = []): RouteObject[] =>
  routes.flatMap((route) => {
    if (route.path === ':workspaceSlug') return route.children ?? [];
    const path = route.path?.replace(/^\//, '') ?? '';
    return path ? [] : findWorkspaceRoutes(route.children);
  });

const routeTables = [webRoutes, electronRoutes, electronMainAreaRoutes, mobileRoutes];

const rootSegments = new Set(routeTables.flatMap((routes) => [...collectRootSegments(routes)]));
const mirroredSegments = new Set(
  routeTables.flatMap((routes) => [...collectRootSegments(findWorkspaceRoutes(routes))]),
);

describe('root route segments', () => {
  it('reserves every root of the route tables', () => {
    const missing = [...rootSegments].filter((s) => !RESERVED_ROOT_SEGMENTS.has(s));
    expect(missing, `Add to RESERVED_ROOT_SEGMENTS: ${missing.join(', ')}`).toEqual([]);
  });

  it('reserves nothing the route tables lack, beyond the off-table roots', () => {
    const stale = [...RESERVED_ROOT_SEGMENTS].filter(
      (s) => !rootSegments.has(s) && !mirroredSegments.has(s) && !OFF_TABLE_ROOT_SEGMENTS.has(s),
    );
    expect(stale, `Not a root route anymore: ${stale.join(', ')}`).toEqual([]);
  });

  it('lists exactly the roots mirrored under /:workspaceSlug', () => {
    expect([...WORKSPACE_MIRRORED_ROOT_SEGMENTS].sort()).toEqual([...mirroredSegments].sort());
  });

  it('parses the first segment of a path', () => {
    expect(parseRootSegment('/goal/g1?x=1')).toBe('goal');
    expect(parseRootSegment('/airi')).toBe('airi');
    expect(parseRootSegment('/')).toBeNull();
  });
});

describe('isWorkspaceSlugCandidatePath', () => {
  it.each([
    '/goal/goal_MkfdMJaxDdRp',
    '/agent/agt_1/goal/goal_1',
    '/task/task_1',
    '/project/proj_1',
    '/acceptance/acc_1',
    '/dashboard',
  ])('treats %s as personal, not as a workspace slug', (path) => {
    expect(isWorkspaceSlugCandidatePath(path)).toBe(false);
  });

  it('treats an unknown root as a slug candidate', () => {
    expect(isWorkspaceSlugCandidatePath('/r1018-team/goal/goal_1')).toBe(true);
  });
});
