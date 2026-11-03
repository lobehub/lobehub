import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mobileRoutes } from './mobileRouter.config';
import { getRouteMetaFromHandle } from './routeMeta';

describe('mobileRouter workspace home', () => {
  it.each(['/acme', '/acme/'])(
    'renders the mobile home page and layout within the workspace boundary at %s',
    (pathname) => {
      const personalMatches = matchRoutes(mobileRoutes, '/')!;
      const workspaceMatches = matchRoutes(mobileRoutes, pathname)!;

      expect(workspaceMatches.some((match) => match.route.path === ':workspaceSlug')).toBe(true);
      expect(workspaceMatches.at(-1)?.params.workspaceSlug).toBe('acme');
      expect(workspaceMatches.at(-1)?.route.element).toBeTruthy();
      expect(workspaceMatches.at(-1)?.route.element).toBe(personalMatches.at(-1)?.route.element);
      expect(workspaceMatches.at(-2)?.route.element).toBe(personalMatches.at(-2)?.route.element);
    },
  );

  it('keeps workspace conversations outside the home layout', () => {
    const homeMatches = matchRoutes(mobileRoutes, '/acme')!;
    const chatMatches = matchRoutes(mobileRoutes, '/acme/agent/agt_fixture')!;
    const homeLayout = homeMatches.at(-2)?.route;

    expect(chatMatches.at(-1)?.params).toMatchObject({ aid: 'agt_fixture', workspaceSlug: 'acme' });
    expect(chatMatches.some((match) => match.route === homeLayout)).toBe(false);
  });
});

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
  it.each([
    ['/tasks', {}],
    ['/goals', {}],
    ['/task/tsk_1', { taskId: 'tsk_1' }],
    // The `:slug?` tail is the readable title segment; it never resolves the
    // task, so pre-slug links keep matching the same route.
    ['/task/tsk_1/fix-login', { slug: 'fix-login', taskId: 'tsk_1' }],
    ['/goal/gol_1', { goalId: 'gol_1' }],
    ['/agent/agt_1/task/tsk_1', { aid: 'agt_1', taskId: 'tsk_1' }],
  ])('mounts %s under the shared task workspace layout', (pathname, params) => {
    const taskWorkspace = matchRoutes(mobileRoutes, '/tasks')!.at(-3)!.route;
    const matches = matchRoutes(mobileRoutes, pathname)!;

    expect(matches.some((match) => match.route === taskWorkspace)).toBe(true);
    expect(matches.at(-1)?.route.path).not.toBe('*');
    expect(matches.at(-1)?.params).toMatchObject(params);
  });
});

describe('mobileRouter workspace provider routes', () => {
  it('registers workspace provider list and path-shaped deep-link redirect', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileWorkspaceSettingsRoutes.tsx'),
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

describe('mobileRouter page routes', () => {
  it('renders /page/:id instead of falling through to the catch-all redirect', () => {
    const matches = matchRoutes(mobileRoutes, '/page/docs_abc123');

    expect(matches?.at(-1)?.route.path).toBe(':id');
    expect(matches?.at(-1)?.params).toMatchObject({ id: 'docs_abc123' });
  });

  it('mirrors the page detail route under a workspace slug', () => {
    const matches = matchRoutes(mobileRoutes, '/my-team/page/docs_abc123');

    expect(matches?.some((match) => match.route.path === ':workspaceSlug')).toBe(true);
    expect(matches?.at(-1)?.route.path).toBe(':id');
  });
});

describe('mobileRouter acceptance routes', () => {
  it('keeps the personal report and check routes unprefixed', () => {
    expect(matchRoutes(mobileRoutes, '/acceptance/acc_1')?.at(-1)?.route.path).toBe(
      '/acceptance/:acceptanceId',
    );
    expect(
      matchRoutes(mobileRoutes, '/acceptance/acc_1/check/chk_1')?.at(-1)?.params,
    ).toMatchObject({ acceptanceId: 'acc_1', checkId: 'chk_1' });
  });

  it('mirrors the report and check routes under a workspace slug', () => {
    const report = matchRoutes(mobileRoutes, '/my-team/acceptance/acc_1');
    const check = matchRoutes(mobileRoutes, '/my-team/acceptance/acc_1/check/chk_1');

    expect(report?.some((match) => match.route.path === ':workspaceSlug')).toBe(true);
    expect(report?.at(-1)?.route.path).toBe('acceptance/:acceptanceId');
    expect(report?.at(-1)?.params).toMatchObject({
      acceptanceId: 'acc_1',
      workspaceSlug: 'my-team',
    });
    expect(check?.at(-1)?.params).toMatchObject({ acceptanceId: 'acc_1', checkId: 'chk_1' });
  });
});

describe('mobileRouter Docs routes', () => {
  it('reuses the desktop Docs subtree and gives the header-less Works view a shell header', () => {
    const works = matchRoutes(mobileRoutes, '/resource/works')!.at(-1)!.route;
    const drive = matchRoutes(mobileRoutes, '/resource/drive/images')!.at(-1)!.route;

    expect((works.handle as { mobileShellHeader?: boolean }).mobileShellHeader).toBe(true);
    expect((drive.handle as { mobileShellHeader?: boolean }).mobileShellHeader).toBeUndefined();
    expect(getRouteMetaFromHandle(works.handle)?.titleKey).toBe('navigation.resourceWorks');
  });
});
