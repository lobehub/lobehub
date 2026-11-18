import { isValidElement } from 'react';
import type { RouteObject } from 'react-router';
import { matchRoutes, Navigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mainAreaMetaRoutes } from './desktopRouter.config';
import { mobileRoutes } from './mobileRouter.config';

const hiddenUrls = [
  '/community/model',
  '/community/model/gpt-5',
  '/community/provider',
  '/community/provider/openai',
].flatMap((url) => [url, `/acme${url}`]);

/**
 * Where a hidden URL ends up: the redirect is a direct child of the `community`
 * route and points at `..`, so it resolves to that route's own URL, which keeps
 * the workspace slug.
 */
const resolveRedirect = (routes: RouteObject[], url: string) => {
  const matches = matchRoutes(routes, url) ?? [];
  const leaf = matches.at(-1);
  const parent = matches.at(-2);
  const element = leaf?.route.element;

  if (!isValidElement<{ to: string }>(element) || element.type !== Navigate) return undefined;
  if (element.props.to !== '..' || parent?.route.path !== 'community') return undefined;

  return parent.pathnameBase;
};

describe('hidden Marketplace sections', () => {
  it.each([
    ['desktop', mainAreaMetaRoutes],
    ['mobile', mobileRoutes],
  ] as const)('opens Agents from the Marketplace index on %s', (_platform, routes) => {
    for (const pathname of ['/community', '/acme/community']) {
      const leaf = matchRoutes(routes, pathname)?.at(-1)?.route;
      expect(leaf?.index).toBe(true);
      expect(leaf?.element).toMatchObject({
        props: { replace: true, to: 'agent' },
        type: Navigate,
      });
    }
  });

  it.each(hiddenUrls)('redirects %s to the Marketplace home on desktop', (url) => {
    expect(resolveRedirect(mainAreaMetaRoutes, url)).toBe(url.replace(/\/(model|provider).*$/, ''));
  });

  it.each(hiddenUrls)('redirects %s to the Marketplace home on mobile', (url) => {
    expect(resolveRedirect(mobileRoutes, url)).toBe(url.replace(/\/(model|provider).*$/, ''));
  });

  it.each([
    '/community/agent',
    '/community/skill',
    '/community/mcp',
    '/community/agent/some-agent',
  ])('keeps %s mounted', (url) => {
    expect(resolveRedirect(mainAreaMetaRoutes, url)).toBeUndefined();
    expect(matchRoutes(mainAreaMetaRoutes, url)?.at(-1)?.route.path).not.toBe('*');
  });
});
