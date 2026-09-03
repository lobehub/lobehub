import type * as BusinessConst from '@lobechat/business-const';
import { describe, expect, it, vi } from 'vitest';

import {
  buildAgentProfileTabOptions,
  buildAgentProfileTabPath,
  supportsMessageChannels,
} from './tabOptions';

// Pin the flag rather than inherit it: `supportsMessageChannels` reads
// EXTERNAL_INTEGRATIONS_ENABLED, so a distribution that ships no messengers
// would otherwise flip the cases below out from under them. The suite is about
// which *agents* can host channels, so it states the deployment side as true
// and covers the off case separately.
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<typeof BusinessConst>()),
  EXTERNAL_INTEGRATIONS_ENABLED: true,
}));

const labels = {
  channel: 'tab.integration',
  profile: 'tab.profile',
  share: 'share',
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

  // Channels are the external-messenger surface, so where a distribution ships
  // none of them the segment must not be offered for any agent — including the
  // cloud agents the case above accepts.
  it('rejects every agent where the distribution ships no external integrations', async () => {
    vi.resetModules();
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      EXTERNAL_INTEGRATIONS_ENABLED: false,
    }));

    const { supportsMessageChannels: withoutIntegrations } = await import('./tabOptions');

    expect(withoutIntegrations()).toBe(false);
    expect(withoutIntegrations('claude-code')).toBe(false);

    vi.doUnmock('@lobechat/business-const');
    vi.resetModules();
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
      shareSupported: true,
    });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
      'channel',
      'statistics',
      'share',
    ]);
  });

  it('drops channels when the agent cannot host them', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      channelsSupported: false,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'statistics']);
  });

  it('drops the config tabs for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      channelsSupported: true,
      labels,
      shareSupported: true,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });

  it('keeps the tab owned by the current page even when it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'channel',
      canConfigure: false,
      channelsSupported: false,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['channel', 'statistics']);
  });

  it('drops share when the agent cannot be shared at all', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      channelsSupported: true,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'channel', 'statistics']);
  });

  it('keeps share when it owns the current page even though it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'share',
      canConfigure: false,
      channelsSupported: false,
      labels,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics', 'share']);
  });
});
