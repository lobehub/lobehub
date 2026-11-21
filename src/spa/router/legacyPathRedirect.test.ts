import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
} from '@/features/Marketplace/paths';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import {
  buildLegacyCommunityRedirectPath,
  buildLegacyRedirectPath,
  LegacyPathRedirect,
} from './legacyPathRedirect';
import { legacyCommunityRoutes, marketplaceIndexRoute } from './marketplaceRoutes';

const CurrentUrl = () => {
  const { hash, pathname, search } = useLocation();
  return createElement('div', { 'data-testid': 'url' }, `${pathname}${search}${hash}`);
};

const currentUrl = createElement(CurrentUrl);
const agentPage = createElement('div', { 'data-testid': 'url' }, 'agent page');
const redirectTo = (to: string) => createElement(LegacyPathRedirect, { to });

/** A route table shaped like the real one: personal and `/:workspaceSlug` mirrors. */
const renderAt = (url: string, serverConfigInit = true) => {
  const store = initServerConfigStore({ serverConfigInit });
  const legacy = [
    { element: redirectTo(MARKETPLACE_INSTALLED_SKILLS_PATH), path: 'skill' },
    { element: redirectTo(MARKETPLACE_INSTALLED_SKILLS_PATH), path: 'skill/:sub' },
    { element: redirectTo(MARKETPLACE_INSTALLED_CONNECTORS_PATH), path: 'connector' },
    { element: redirectTo(MARKETPLACE_INSTALLED_CONNECTORS_PATH), path: 'connector/:sub' },
  ];
  // The real legacy table, beside a workspace agent route that competes for
  // `/community/agent/:id` (a lone `community/*` splat lost to it).
  const shared = [
    ...legacyCommunityRoutes,
    // The real tree has static `marketplace/<section>` routes that outrank the workspace ones.
    { children: [marketplaceIndexRoute], path: 'marketplace' },
    { element: currentUrl, path: 'marketplace/*' },
    { element: currentUrl, path: 'marketplace/connector' },
    { element: currentUrl, path: 'marketplace/agent' },
    { element: currentUrl, path: 'marketplace/agent/:slug' },
    {
      children: [{ element: agentPage, index: true }],
      path: 'agent/:aid',
    },
    { element: agentPage, path: 'agent' },
  ];
  const router = createMemoryRouter(
    [
      {
        children: [
          ...shared,
          { children: legacy, path: 'settings' },
          {
            children: [...shared, { children: legacy, path: 'settings' }],
            path: ':workspaceSlug',
          },
        ],
        path: '/',
      },
    ],
    { initialEntries: [url] },
  );

  render(
    createElement(Provider, {
      children: createElement(RouterProvider, { router }),
      createStore: () => store,
    }),
  );
  return { router, store };
};

describe('buildLegacyRedirectPath', () => {
  it('keeps query and hash and re-applies the workspace slug', () => {
    expect(
      buildLegacyRedirectPath('/marketplace/connector', {
        hash: '#top',
        search: '?open=mcp-connector%3Amwe',
        workspaceSlug: 'acme',
      }),
    ).toBe('/acme/marketplace/connector?open=mcp-connector%3Amwe#top');
    expect(buildLegacyRedirectPath('/marketplace/connector')).toBe('/marketplace/connector');
  });

  it('maps the old community root and sub-paths onto the marketplace', () => {
    expect(buildLegacyCommunityRedirectPath('/community')).toBe('/marketplace');
    expect(buildLegacyCommunityRedirectPath('/community/')).toBe('/marketplace');
    expect(
      buildLegacyCommunityRedirectPath('/community/mcp/notion', { search: '?activeTab=schema' }),
    ).toBe('/marketplace/mcp/notion?activeTab=schema');
    expect(
      buildLegacyCommunityRedirectPath('/acme/community/agent/x', { workspaceSlug: 'acme' }),
    ).toBe('/acme/marketplace/agent/x');
  });
});

describe('legacy URL redirects', () => {
  it.each([
    [true, '/acme/marketplace/connector?q=developer#results'],
    [false, '/acme/marketplace/connector/installed?q=developer#results'],
  ] as const)(
    'opens the original bookmark directly after loading showMarket=%s',
    async (showMarket, destination) => {
      const { router, store } = renderAt('/acme/community?q=developer#results', false);
      expect(router.state.location.pathname).toBe('/acme/community');
      await act(() => {
        store.setState({
          featureFlags: { ...store.getState().featureFlags, showMarket },
          serverConfigInit: true,
        });
      });
      expect(screen.getByTestId('url').textContent).toBe(destination);
    },
  );

  it.each([
    // Settings skill / connector moved to the Marketplace (personal scope).
    ['/settings/skill', '/marketplace/skill/installed'],
    ['/settings/skill?skill=web-search', '/marketplace/skill/installed?skill=web-search'],
    ['/settings/skill/anything', '/marketplace/skill/installed'],
    ['/settings/connector', '/marketplace/connector/installed'],
    [
      '/settings/connector?open=agent-connector%3Arow-own',
      '/marketplace/connector/installed?open=agent-connector%3Arow-own',
    ],
    ['/settings/connector/legacy#section', '/marketplace/connector/installed#section'],
    // Workspace scope keeps its slug.
    ['/acme/settings/skill', '/acme/marketplace/skill/installed'],
    [
      '/acme/settings/connector?open=mcp-connector%3Amwe',
      '/acme/marketplace/connector/installed?open=mcp-connector%3Amwe',
    ],
    // `/community` became `/marketplace`.
    ['/marketplace', '/marketplace/connector'],
    ['/community', '/marketplace/connector'],
    ['/community/skill?category=dev&page=2', '/marketplace/skill?category=dev&page=2'],
    ['/community/mcp/notion', '/marketplace/mcp/notion'],
    ['/acme/community', '/acme/marketplace/connector'],
    ['/acme/marketplace?q=developer#results', '/acme/marketplace/connector?q=developer#results'],
    ['/acme/community/agent/some-agent#top', '/acme/marketplace/agent/some-agent#top'],
    ['/community/agent', '/marketplace/agent'],
    ['/community/agent/some-agent', '/marketplace/agent/some-agent'],
    ['/community/workspace/settings', '/marketplace/workspace/settings'],
    ['/community/whatever/deep/path', '/marketplace/whatever/deep/path'],
  ])('%s → %s', (from, to) => {
    renderAt(from);
    expect(screen.getByTestId('url').textContent).toBe(to);
  });
});
