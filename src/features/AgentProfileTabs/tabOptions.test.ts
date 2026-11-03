import { describe, expect, it } from 'vitest';

import { buildAgentProfileTabOptions, buildAgentProfileTabPath } from './tabOptions';

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

  it('allows configuring channels even when the agent needs a device to execute', () => {
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

  it('drops share when the agent cannot be shared at all', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'channel', 'statistics']);
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
