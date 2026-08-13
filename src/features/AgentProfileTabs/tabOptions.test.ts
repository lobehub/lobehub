import { describe, expect, it } from 'vitest';

import {
  buildAgentProfileTabOptions,
  buildAgentProfileTabPath,
  supportsMessageChannels,
} from './tabOptions';

const labels = {
  channel: 'tab.integration',
  profile: 'tab.profile',
  statistics: 'usageStats.title',
};

describe('supportsMessageChannels', () => {
  it('allows cloud agents and the CLI providers that host channels', () => {
    expect(supportsMessageChannels()).toBe(true);
    expect(supportsMessageChannels('claude-code')).toBe(true);
    expect(supportsMessageChannels('codex')).toBe(true);
  });

  it('rejects device-only heterogeneous agents', () => {
    expect(supportsMessageChannels('opencode')).toBe(false);
  });
});

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
      channelsSupported: true,
      labels,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'channel', 'statistics']);
  });

  it('drops channels when the agent cannot host them', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      channelsSupported: false,
      labels,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'statistics']);
  });

  it('drops the config tabs for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      channelsSupported: true,
      labels,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });

  it('keeps the tab owned by the current page even when it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'channel',
      canConfigure: false,
      channelsSupported: false,
      labels,
    });

    expect(options.map((option) => option.value)).toEqual(['channel', 'statistics']);
  });
});
