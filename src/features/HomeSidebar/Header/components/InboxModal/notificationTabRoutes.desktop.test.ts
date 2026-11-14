import { describe, expect, it } from 'vitest';

import { mainAreaMetaRoutes } from '@/spa/router/desktopRouter.config.desktop';

import { resolveNotificationAction } from './resolveNotificationAction';

const env = { appOrigin: 'https://lobehub.com', desktopTabRoutes: mainAreaMetaRoutes };

describe('notification actions against the desktop tab route table', () => {
  it.each(['/invite/tok_123', '/onboarding'])('opens %s in the system browser', (actionUrl) => {
    expect(resolveNotificationAction(actionUrl, env)).toEqual({
      type: 'external',
      url: `https://lobehub.com${actionUrl}`,
    });
  });

  it.each([
    '/agent/agent-1/topic-1',
    '/acme/agent/agent-1/topic-1?comment=c1',
    '/acme/settings/members',
    '/settings/notification',
    '/image?topic=topic-1',
    '/acme',
  ])('keeps %s inside the tab', (actionUrl) => {
    expect(resolveNotificationAction(actionUrl, env)).toEqual({
      path: actionUrl,
      type: 'navigate',
    });
  });
});
