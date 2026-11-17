import { isValidElement } from 'react';
import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { matchRouteMeta } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';

import { mainAreaMetaRoutes } from './desktopRouter.config';
// vitest skips the platformResolve plugin, so the Electron adapter is imported by path.
import { mainAreaMetaRoutes as electronMainAreaMetaRoutes } from './desktopRouter.config.desktop';
import { mobileRoutes } from './mobileRouter.config';
import { getRouteMetaFromHandle, type RouteMeta } from './routeMeta';

/**
 * Leaf routes whose document title falls back to the bare brand. The title
 * comes from the deepest matched route that declares a meta (as
 * `RouteMetaBridge` resolves it), so a leaf inheriting a skeleton-only layout
 * meta is untitled too. `<Navigate>` redirects never paint and are skipped.
 */
const collectUntitledLeaves = (
  routes: RouteObject[],
  prefix = '',
  inherited?: RouteMeta,
): string[] =>
  routes.flatMap((route) => {
    const path = route.path
      ? route.path.startsWith('/')
        ? route.path
        : `${prefix.replace(/\/$/, '')}/${route.path}`
      : prefix;
    const meta = getRouteMetaFromHandle(route.handle) ?? inherited;

    if (route.children?.length) return collectUntitledLeaves(route.children, path, meta);
    if (isValidElement(route.element) && route.element.type === Navigate) return [];
    if (meta?.titleKey || meta?.DynamicMeta) return [];

    return [path || '/'];
  });

/** Routes that paint without a title of their own, each for a stated reason. */
const UNTITLED_ALLOWED = [
  // Legacy deep-links that redirect from inside a lazy page.
  /\/agent\/:aid\/self-evolving\/:domainId\/rules\/:lessonId$/,
  /\/agent\/:aid\/self-learning\/\*$/,
  /\/project\/:projectId\/conversation\/:topicId\?$/,
  /\/settings\/drive$/,
  /\/:workspaceSlug\/settings\/provider\/:providerId$/,
  // The community workspace profile is a Cloud surface; the OSS build stubs it.
  /\/community\/workspace(\/settings)?$/,
  // The eval lab is an internal tool.
  /\/eval(\/|$)/,
  // Catch-all and standalone pages outside the main area.
  /^\/\*$/,
  /^\/onboarding$/,
  /^\/verify-im$/,
];

const unexpectedUntitled = (routes: RouteObject[]) =>
  collectUntitledLeaves(routes).filter((path) => !UNTITLED_ALLOWED.some((re) => re.test(path)));

describe('route document titles', () => {
  it('gives every desktop page a title', () => {
    expect(unexpectedUntitled(mainAreaMetaRoutes)).toEqual([]);
  });

  it('gives every Electron tab page a title', () => {
    expect(unexpectedUntitled(electronMainAreaMetaRoutes)).toEqual([]);
  });

  it('gives every mobile page a title', () => {
    expect(unexpectedUntitled(mobileRoutes)).toEqual([]);
  });

  // Each of these shows one entity, so a static label ("Pages", "Discover",
  // "Settings") would name every tab the same.
  const entityUrls = [
    '/resource/page/abc',
    '/resource/file/file_1',
    '/resource/library/kb_1',
    '/resource/library/kb_1/folder/docs_1',
    '/resource/library/kb_1/docs/docs_2',
    '/resource/library/kb_1/file/file_2',
    '/team/resource/page/abc',
    '/community/agent/some-agent',
    '/community/group_agent/some-group',
    '/community/model/gpt-5',
    '/community/provider/openai',
    '/community/skill/some-skill',
    '/community/mcp/some-mcp',
    '/community/user/someone',
    '/community/org/some-org',
    '/dashboard/dsh_1',
    '/project/prj_1/dashboard/dsh_1',
    '/settings/provider/openai',
    '/team/settings/members',
    '/team/settings/provider',
  ];

  it.each(entityUrls)('resolves %s to a dynamic title on desktop', (url) => {
    expect(matchRouteMeta(mainAreaMetaRoutes, url).meta?.DynamicMeta).toBeDefined();
  });

  it.each(entityUrls)('resolves %s to a dynamic title on mobile', (url) => {
    expect(matchRouteMeta(mobileRoutes, url).meta?.DynamicMeta).toBeDefined();
  });
});
