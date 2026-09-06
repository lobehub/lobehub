import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mobileRoutes } from './mobileRouter.config';

describe('mobileRouter agent share route', () => {
  it('serves the agent-share visitor page on /a/:slugOrId outside the main layout', () => {
    const matches = matchRoutes(mobileRoutes, '/a/my-agent');

    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.route.path).toBe('/a/:slugOrId');
    expect(matches?.[0]?.params).toMatchObject({ slugOrId: 'my-agent' });
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
    expect(source).toContain("path: ':taskId'");
    expect(source).toContain("path: ':aid/task/:taskId'");
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
  it('wraps shared community list and detail pages in SWR suspense boundaries', async () => {
    const readLayout = (layoutPath: string) =>
      readFile(path.join(process.cwd(), layoutPath), 'utf8');

    const [listLayout, detailLayout] = await Promise.all([
      readLayout('src/routes/(mobile)/community/(list)/_layout/index.tsx'),
      readLayout('src/routes/(mobile)/community/(detail)/_layout/index.tsx'),
    ]);

    for (const source of [listLayout, detailLayout]) {
      expect(source).toContain("import { SWRConfig } from 'swr'");
      expect(source).toContain(
        "import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary'",
      );
      expect(source).toContain('<SWRConfig value={{ suspense: true }}>');
      expect(source).toContain('<SuspenseRouteBoundary>');
      expect(source).toContain('<Outlet />');
    }
  });
});

describe('mobileRouter workspace Trash route', () => {
  it('registers the workspace Trash settings page', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/router/mobileRouter.config.tsx'),
      'utf8',
    );

    expect(source).toContain("import('@/routes/(main)/[workspaceSlug]/settings/trash')");
    expect(source).toContain("path: 'trash'");
  });
});
