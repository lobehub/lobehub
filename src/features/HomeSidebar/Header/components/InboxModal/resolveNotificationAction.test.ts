import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { resolveNotificationAction } from './resolveNotificationAction';

const desktopTabRoutes: RouteObject[] = [
  {
    children: [
      { path: 'agent/:agentId/:topicId?' },
      { children: [{ path: 'billing' }, { path: 'credits' }], path: 'subscription' },
      { children: [{ path: 'notification' }], path: 'settings' },
      {
        children: [{ index: true }, { path: 'task/:taskId' }, { path: 'settings/:tab' }],
        path: ':workspaceSlug',
      },
      { index: true },
      { path: '*' },
    ],
    path: '/',
  },
];

const desktop = { appOrigin: 'https://lobehub.com', desktopTabRoutes };
const web = { appOrigin: 'https://lobehub.com' };

describe('resolveNotificationAction', () => {
  it('opens a workspace invite in the system browser on desktop', () => {
    expect(resolveNotificationAction('/invite/tok_123', desktop)).toEqual({
      type: 'external',
      url: 'https://lobehub.com/invite/tok_123',
    });
  });

  it('keeps the query string of a path the tab routers cannot serve', () => {
    expect(resolveNotificationAction('/waitlist/workspace?from=inbox', desktop)).toEqual({
      type: 'external',
      url: 'https://lobehub.com/waitlist/workspace?from=inbox',
    });
  });

  it('opens a reserved root the tab routers would read as a workspace slug externally', () => {
    expect(resolveNotificationAction('/onboarding', desktop)).toEqual({
      type: 'external',
      url: 'https://lobehub.com/onboarding',
    });
  });

  it('navigates in-app to a workspace invite on web', () => {
    expect(resolveNotificationAction('/invite/tok_123', web)).toEqual({
      path: '/invite/tok_123',
      type: 'navigate',
    });
  });

  it.each([
    '/agent/agent-1/topic-1',
    '/subscription/billing',
    '/acme/task/T-1',
    '/acme/settings/billing?issue=payment_failed',
    '/settings/notification',
    '/acme',
    '/',
  ])('navigates in-app on desktop for a path the tab routers serve: %s', (actionUrl) => {
    expect(resolveNotificationAction(actionUrl, desktop)).toEqual({
      path: actionUrl,
      type: 'navigate',
    });
  });

  it.each([desktop, web])('opens an absolute link externally', (env) => {
    expect(resolveNotificationAction('https://example.com/changelog', env)).toEqual({
      type: 'external',
      url: 'https://example.com/changelog',
    });
  });

  it('falls back to in-app navigation on desktop when no app origin is configured', () => {
    expect(
      resolveNotificationAction('/invite/tok_123', { appOrigin: '', desktopTabRoutes }),
    ).toEqual({
      path: '/invite/tok_123',
      type: 'navigate',
    });
  });
});
