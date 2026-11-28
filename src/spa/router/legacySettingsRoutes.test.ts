import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { legacySettingsTabRedirects, legacyWorkspaceBillingRoute } from './legacySettingsRoutes';

const CurrentUrl = () => {
  const { pathname } = useLocation();
  return createElement('div', { 'data-testid': 'url' }, pathname);
};

const currentUrl = createElement(CurrentUrl);
const workspacePage = (name: string) => createElement('div', { 'data-testid': 'url' }, name);

/**
 * Shaped like the real tree: personal `/settings/:tab`, beside the workspace
 * pages whose `/:workspaceSlug/agent` and `/:workspaceSlug/image` compete for
 * `/settings/agent` and `/settings/image`.
 */
const renderAt = async (url: string) => {
  const router = createMemoryRouter(
    [
      {
        children: [...legacySettingsTabRedirects, { element: currentUrl, path: ':tab' }],
        path: 'settings',
      },
      {
        children: [
          { element: workspacePage('workspace agent page'), path: 'agent' },
          { element: workspacePage('workspace image page'), path: 'image' },
          { children: [{ element: currentUrl, path: ':tab' }], path: 'settings' },
          legacyWorkspaceBillingRoute,
        ],
        path: ':workspaceSlug',
      },
      { element: workspacePage('home'), path: '*' },
    ],
    { initialEntries: [url] },
  );

  render(createElement(RouterProvider, { router }));
  return (await screen.findByTestId('url')).textContent;
};

describe('legacy settings links', () => {
  it.each([
    ['/settings/agent', '/settings/service-model'],
    ['/settings/image', '/settings/service-model'],
    ['/settings/tts', '/settings/service-model'],
    ['/settings/common', '/settings/appearance'],
    ['/settings/chat-appearance', '/settings/conversation'],
  ])('opens %s at %s', async (from, to) => {
    expect(await renderAt(from)).toBe(to);
  });

  it.each([
    ['/acme/billing/plans', '/acme/settings/plans'],
    ['/acme/billing/usage', '/acme/settings/usage'],
    ['/acme/billing/credits', '/acme/settings/credits'],
    ['/acme/billing/billing', '/acme/settings/billing'],
  ])('opens %s at %s', async (from, to) => {
    expect(await renderAt(from)).toBe(to);
  });
});
