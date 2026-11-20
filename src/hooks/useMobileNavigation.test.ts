import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useMobileNavigation } from './useMobileNavigation';

describe('useMobileNavigation', () => {
  it.each([
    ['/', true, 'chat'],
    // The Marketplace keeps its `community` tab key under the `/marketplace` URL.
    ['/marketplace', true, 'community'],
    ['/marketplace/skill', true, 'community'],
    // Management pages are second-level pages with a back header, not tab roots.
    ['/marketplace/skill/installed', false, 'community'],
    // Connectors' Discover view (the former MCP list) is a tab root; Installed is not.
    ['/marketplace/connector', true, 'community'],
    ['/marketplace/connector/installed', false, 'community'],
    ['/me', true, 'me'],
    ['/agent/agt_fixture', false, 'agent'],
    ['/acme', true, 'chat'],
    ['/acme/', true, 'chat'],
    ['/acme/marketplace', true, 'community'],
    ['/acme/marketplace/agent', true, 'community'],
    ['/acme/marketplace/agent/', true, 'community'],
    ['/acme/marketplace/agent/agt_fixture', false, 'community'],
    ['/acme/agent/agt_fixture', false, 'agent'],
    ['/acme/settings/general', false, 'settings'],
  ])('resolves navigation for %s', (pathname, showNav, activeKey) => {
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(RouterProvider, {
        router: createMemoryRouter(
          [
            {
              children: [
                { index: true },
                { path: 'agent/*' },
                { path: 'marketplace/*' },
                { path: 'me/*' },
                { path: ':workspaceSlug/*' },
              ],
              element: children,
              path: '/',
            },
          ],
          { initialEntries: [pathname] },
        ),
      });

    const { result } = renderHook(useMobileNavigation, { wrapper });

    expect(result.current).toEqual({ activeKey, showNav });
  });
});
