import type { RouteObject } from 'react-router';
import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mainAreaMetaRoutes } from './desktopRouter.config';
import { mobileRoutes } from './mobileRouter.config';

/** Every leaf path pattern of a route tree, joined from the root. */
const collectLeafPatterns = (routes: RouteObject[], prefix = ''): string[] =>
  routes.flatMap((route) => {
    const path = route.path
      ? route.path.startsWith('/')
        ? route.path
        : `${prefix.replace(/\/$/, '')}/${route.path}`
      : prefix;
    return route.children?.length ? collectLeafPatterns(route.children, path) : [path || '/'];
  });

/** A concrete URL for a pattern: params become sample values, optional tails drop. */
const toSampleUrl = (pattern: string) =>
  pattern
    .replaceAll(/\/:[A-Z]+\?/gi, '')
    .replaceAll(':workspaceSlug', 'acme')
    .replaceAll(/:([A-Z]+)/gi, 'sample_$1')
    .replaceAll('/*', '/rest')
    .replaceAll(/\/+/g, '/');

/** The route pattern a URL resolved to, e.g. `agent/:aid/profile` or `:workspaceSlug`. */
const resolvedPattern = (routes: RouteObject[], url: string) =>
  (matchRoutes(routes, url) ?? [])
    .map((match) => match.route.path)
    .filter((path): path is string => !!path && path !== '/')
    .join('/')
    .replaceAll(/\/+/g, '/')
    .replace(/^\//, '');

// Desktop surfaces mobile intentionally leaves out. They redirect home instead
// of being read as a workspace slug.
const MOBILE_UNSUPPORTED = [/^\/(acme\/)?eval(\/|$)/];

const desktopUrls = [...new Set(collectLeafPatterns(mainAreaMetaRoutes).map(toSampleUrl))]
  .filter((url) => url !== '/rest')
  .sort();

describe('mobile router parity with the desktop main area', () => {
  it('covers a meaningful slice of the desktop tree', () => {
    expect(desktopUrls.length).toBeGreaterThan(150);
  });

  it.each(desktopUrls.filter((url) => !MOBILE_UNSUPPORTED.some((re) => re.test(url))))(
    'resolves %s to the same route pattern as desktop',
    (url) => {
      // A mismatch means mobile hit the `*` catch-all, read a reserved path as
      // `:workspaceSlug`, or swallowed a page name into a dynamic segment such
      // as the chat's `:topicId`.
      expect(resolvedPattern(mobileRoutes, url)).toBe(resolvedPattern(mainAreaMetaRoutes, url));
    },
  );

  it.each(desktopUrls.filter((url) => MOBILE_UNSUPPORTED.some((re) => re.test(url))))(
    'keeps desktop-only %s out of the workspace slug',
    (url) => {
      const matches = matchRoutes(mobileRoutes, url) ?? [];
      const isWorkspaceUrl = url.startsWith('/acme/');

      expect(matches.at(-1)?.route.path).toBe('eval/*');
      expect(matches.some((match) => match.route.path === ':workspaceSlug')).toBe(isWorkspaceUrl);
    },
  );
});
