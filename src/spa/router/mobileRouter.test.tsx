import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mobileRoutes } from './mobileRouter.config';
import { getRouteMetaFromHandle } from './routeMeta';

describe('mobileRouter agent share route', () => {
  it('leaves the agent-share visitor surface to the business routes', () => {
    // Agent sharing runs a visitor's conversation on the creator's account, so
    // the surface ships with the deployment that does that accounting and
    // registers itself through `BusinessMobileRoutesWithoutMainLayout`.
    // Nothing claims `/a/*` any more, so it falls through to not-found.
    expect(matchRoutes(mobileRoutes, '/a/my-agent')?.at(-1)?.route.path).toBe('*');
  });

  it('keeps the creator agent surface on /agent/:aid', () => {
    const matches = matchRoutes(mobileRoutes, '/agent/my-agent');

    expect(matches?.some((match) => match.route.path === ':aid')).toBe(true);
    expect(matches?.at(-1)?.params).toMatchObject({ aid: 'my-agent' });
  });
});

describe('mobileRouter task routes', () => {
  it('registers task list and detail routes under the shared workspace layout', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'),
      'utf8',
    );

    expect(source).toContain("import('@/routes/(main)/(task-workspace)/_layout')");
    expect(source).toContain("import('@/routes/(main)/tasks')");
    expect(source).toContain("import('@/routes/(main)/task/[taskId]')");
    expect(source).toContain("import('@/routes/(main)/agent/task/[taskId]')");
    expect(source).toContain("path: 'tasks'");
    expect(source).toContain("path: 'task'");
    // The `:slug?` tail is the readable title segment; it never resolves the
    // task, so pre-slug links keep matching the same route.
    expect(source).toContain("path: ':taskId/:slug?'");
    expect(source).toContain("path: ':aid/task/:taskId/:slug?'");
    expect(source).not.toContain("import('@/routes/(main)/tasks/_layout')");
  });
});

describe('mobileRouter workspace provider routes', () => {
  it('registers workspace provider list and path-shaped deep-link redirect', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'),
      'utf8',
    );

    // Without these, workspace-aware provider links (`/:slug/settings/provider/:id`)
    // fall through to the mobile `*` route and kick the user out of the workspace.
    expect(source).toContain("import('@/routes/(main)/[workspaceSlug]/settings/provider')");
    // The mobile route must use the mobile variant, otherwise the page renders
    // the desktop 280px provider menu layout on phones.
    expect(source).toContain('m.WorkspaceProviderSettingMobile');
    // The redirect is statically imported: lazy-loading it would flash the
    // generic brand loader before redirecting.
    expect(source).toContain("from '@/features/WorkspaceSetting/ProviderRedirect'");
    expect(source).toContain("path: 'provider'");
    expect(source).toContain("path: 'provider/:providerId'");
  });
});

describe('mobile community route layouts', () => {
  it('renders community list and detail pages without layout-level SWR suspense', async () => {
    const readLayout = (layoutPath: string) =>
      readFile(path.join(process.cwd(), layoutPath), 'utf8');

    const [listLayout, detailLayout] = await Promise.all([
      readLayout('src/routes/(mobile)/community/(list)/_layout/index.tsx'),
      readLayout('src/routes/(mobile)/community/(detail)/_layout/index.tsx'),
    ]);

    for (const source of [listLayout, detailLayout]) {
      expect(source).not.toContain('SWRConfig');
      expect(source).not.toContain('SuspenseRouteBoundary');
      expect(source).toContain('<RouteSkeletonChromeProvider>');
      expect(source).toContain('<Outlet />');
    }
  });

  it('declares a route skeleton for the community list and detail layouts', () => {
    const listMatches = matchRoutes(mobileRoutes, '/community/agent');
    const detailMatches = matchRoutes(mobileRoutes, '/community/agent/my-agent');

    expect(listMatches?.some((match) => getRouteMetaFromHandle(match.route.handle)?.Skeleton)).toBe(
      true,
    );
    expect(
      detailMatches?.some((match) => getRouteMetaFromHandle(match.route.handle)?.Skeleton),
    ).toBe(true);
  });
});
