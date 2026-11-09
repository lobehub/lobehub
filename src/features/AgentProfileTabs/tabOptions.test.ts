import { describe, expect, it } from 'vitest';

import {
  buildAgentProfileTabOptions,
  buildAgentProfileTabPath,
  getAgentProfileTab,
} from './tabOptions';

const labels = {
  channel: 'tab.integration',
  profile: 'tab.profile',
  share: 'share',
  statistics: 'usageStats.title',
};

describe('buildAgentProfileTabPath', () => {
  it('builds the sub-route of the agent', () => {
    expect(buildAgentProfileTabPath('agt_1', 'statistics')).toBe('/agent/agt_1/statistics');
  });
});

describe('getAgentProfileTab', () => {
  it.each([
    ['/agent/agt_1/profile', 'profile'],
    ['/agent/agt_1/channel/slack', 'channel'],
    ['/acme/agent/agt_1/statistics/', 'statistics'],
    ['/_dangerous_local_dev_proxy/acme/agent/agt_1/share', 'share'],
  ])('maps %s to its tab', (pathname, tab) => {
    expect(getAgentProfileTab(pathname)).toBe(tab);
  });

  it.each(['/agent/agt_1', '/agent/agt_1/tpc_1', '/agent/agt_1/share/extra', '/settings/profile'])(
    'leaves %s outside the group',
    (pathname) => {
      expect(getAgentProfileTab(pathname)).toBeUndefined();
    },
  );
});

describe('buildAgentProfileTabOptions', () => {
  it('lists the full group for a member who can configure the agent', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      labels,
      shareSupported: true,
    });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
      'channel',
      'statistics',
      'share',
    ]);
  });

  it('keeps configuration tabs when sharing is unsupported', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'channel', 'statistics']);
  });

  it('drops the config tabs for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      labels,
      shareSupported: true,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });

  it('keeps the tab owned by the current page even when it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'channel',
      canConfigure: false,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['channel', 'statistics']);
  });

  it('keeps share when it owns the current page even though it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'share',
      canConfigure: false,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics', 'share']);
  });
});
