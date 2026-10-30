import { describe, expect, it } from 'vitest';

import { isAgentProfileRoute } from './isAgentProfileRoute';

describe('isAgentProfileRoute', () => {
  it.each([
    '/agent/agt_1/profile',
    '/agent/agt_1/channel',
    '/agent/agt_1/channel/slack',
    '/agent/agt_1/statistics',
    '/acme/agent/agt_1/profile',
    '/acme/agent/agt_1/channel/slack',
    '/acme/agent/agt_1/statistics/',
    '/_dangerous_local_dev_proxy/acme/agent/agt_1/profile',
  ])('selects the profile entry on %s', (pathname) => {
    expect(isAgentProfileRoute(pathname)).toBe(true);
  });

  it.each([
    '/channels/chn_1',
    '/acme/channels/chn_1',
    '/project/pro_1/channels/chn_1',
    '/agent/agt_1',
    '/agent/agt_1/tpc_1',
    '/channel-team/agent/agt_1',
    '/profile-team/agent/agt_1',
    '/agent/agt_1/channel-topic',
    '/group/grp_1/profile',
    '/settings/profile',
  ])('does not select the profile entry on %s', (pathname) => {
    expect(isAgentProfileRoute(pathname)).toBe(false);
  });
});
