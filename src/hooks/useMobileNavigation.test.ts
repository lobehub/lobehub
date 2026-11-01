import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useMobileNavigation } from './useMobileNavigation';

describe('useMobileNavigation', () => {
  it.each([
    ['/', true, 'chat'],
    ['/community', true, 'community'],
    ['/me', true, 'me'],
    ['/agent/agt_fixture', false, 'agent'],
    ['/acme', true, 'chat'],
    ['/acme/', true, 'chat'],
    ['/acme/community', true, 'community'],
    ['/acme/community/agent', true, 'community'],
    ['/acme/community/agent/', true, 'community'],
    ['/acme/community/agent/agt_fixture', false, 'community'],
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
                { path: 'community/*' },
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
