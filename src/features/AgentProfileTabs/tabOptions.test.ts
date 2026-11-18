import { describe, expect, it } from 'vitest';

import {
  type AgentProfileTab,
  buildAgentProfileTabOptions,
  buildAgentProfileTabPath,
  getAgentProfileTab,
  groupAgentProfileTabOptions,
} from './tabOptions';

const labels = {
  'automations': 'tab.automations',
  'channel': 'tab.integration',
  'engine': 'tab.engine',
  'environment': 'tab.environment',
  'instruction': 'tab.instruction',
  'knowledge': 'tab.knowledge',
  'mail': 'tab.mail',
  'profile': 'tab.profile',
  'self-evolving': 'title',
  'share': 'share',
  'skills': 'tab.skills',
  'statistics': 'usageStats.title',
  'tools': 'tab.tools',
  'webhook': 'tab.webhook',
};

describe('buildAgentProfileTabPath', () => {
  it('builds the sub-route of the agent', () => {
    expect(buildAgentProfileTabPath('agt_1', 'statistics')).toBe('/agent/agt_1/statistics');
  });
});

describe('getAgentProfileTab', () => {
  it('keeps the mail tab active on an opened message', () => {
    expect(getAgentProfileTab('/agent/agt_1/mail/msg_1')).toBe('mail');
  });

  it.each([
    ['/agent/agt_1/profile', 'profile'],
    ['/agent/agt_1/mail', 'mail'],
    ['/agent/agt_1/channel/slack', 'channel'],
    ['/acme/agent/agt_1/statistics/', 'statistics'],
    ['/_dangerous_local_dev_proxy/acme/agent/agt_1/share', 'share'],
    ['/agent/agt_1/self-evolving', 'self-evolving'],
    ['/agent/agt_1/webhook', 'webhook'],
    ['/acme/agent/agt_1/automations', 'automations'],
    ['/agent/agt_1/self-evolving/new', 'self-evolving'],
    ['/acme/agent/agt_1/self-evolving/dom_1/experience/les_1', 'self-evolving'],
  ])('maps %s to its tab', (pathname, tab) => {
    expect(getAgentProfileTab(pathname)).toBe(tab);
  });

  it.each([
    '/agent/agt_1',
    '/agent/agt_1/tpc_1',
    '/agent/agt_1/share/extra',
    '/agent/agt_1/self-evolving-x',
    '/settings/profile',
  ])('leaves %s outside the group', (pathname) => {
    expect(getAgentProfileTab(pathname)).toBeUndefined();
  });
});

describe('buildAgentProfileTabOptions', () => {
  it('lists the full group for a member who can configure the agent', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      labels,
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: true,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
      'instruction',
      'knowledge',
      'engine',
      'tools',
      'skills',
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
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
      'instruction',
      'knowledge',
      'engine',
      'tools',
      'skills',
      'channel',
      'statistics',
    ]);
  });

  it('drops the config tabs for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      labels,
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: true,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });

  it('keeps the tab owned by the current page even when it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'channel',
      canConfigure: false,
      labels,
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['channel', 'statistics']);
  });

  it('keeps share when it owns the current page even though it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'share',
      canConfigure: false,
      labels,
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics', 'share']);
  });

  it('lists mail after the profile only where it is supported', () => {
    const options = buildAgentProfileTabOptions({
      active: 'profile',
      canConfigure: true,
      labels,
      mailSupported: true,
      selfLearningSupported: false,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
      'instruction',
      'knowledge',
      'engine',
      'tools',
      'skills',
      'mail',
      'channel',
      'statistics',
    ]);
  });

  it('lists self-evolving only where it is supported, regardless of edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      labels,
      mailSupported: false,
      selfLearningSupported: true,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['self-evolving', 'statistics']);
  });

  it('keeps self-evolving when it owns the current page even though it is gated off', () => {
    const options = buildAgentProfileTabOptions({
      active: 'self-evolving',
      canConfigure: false,
      labels,
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['self-evolving', 'statistics']);
  });

  it('drops mail for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      labels,
      mailSupported: true,
      selfLearningSupported: false,
      shareSupported: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });
});

describe('instruction, knowledge, engine, environment, tools and skills tabs', () => {
  const base = {
    active: 'profile' as const,
    canConfigure: true,
    labels,
    mailSupported: false,
    selfLearningSupported: false,
    shareSupported: false,
  };

  it('leaves instruction, knowledge, tools and skills out, and adds environment, for agents that bring their own', () => {
    const options = buildAgentProfileTabOptions({ ...base, heterogeneous: true });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
      'engine',
      'environment',
      'channel',
      'statistics',
    ]);
  });

  it('keeps tools when it owns the current page even if the agent has none', () => {
    const options = buildAgentProfileTabOptions({
      ...base,
      active: 'tools',
      heterogeneous: true,
    });

    expect(options.map((option) => option.value)).toContain('tools');
  });

  it('drops the configuration pages for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      ...base,
      active: 'statistics',
      canConfigure: false,
      heterogeneous: false,
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });

  it.each([
    ['/agent/agt_1/engine', 'engine'],
    ['/agent/agt_1/environment', 'environment'],
    ['/acme/agent/agt_1/tools', 'tools'],
    ['/agent/agt_1/instruction', 'instruction'],
    ['/agent/agt_1/skills', 'skills'],
    ['/agent/agt_1/knowledge', 'knowledge'],
  ])('maps %s to its tab', (pathname, tab) => {
    expect(getAgentProfileTab(pathname)).toBe(tab);
  });
});

describe('groupAgentProfileTabOptions', () => {
  const option = (value: AgentProfileTab) => ({
    label: value,
    value,
  });

  it('keeps who-it-is on top, then the setup pages, then mail and IM bots under identity', () => {
    const groups = groupAgentProfileTabOptions(
      (
        [
          'profile',
          'instruction',
          'knowledge',
          'engine',
          'environment',
          'tools',
          'skills',
          'mail',
          'channel',
          'self-evolving',
          'statistics',
          'share',
        ] as const
      ).map(option),
    );

    expect(groups.map((group) => [group.key, group.options.map((item) => item.value)])).toEqual([
      ['profile', ['profile']],
      ['shape', ['instruction', 'knowledge']],
      ['setup', ['engine', 'environment', 'tools', 'skills']],
      ['identity', ['mail', 'channel']],
      ['general', ['self-evolving', 'statistics', 'share']],
    ]);
  });

  it('leaves out a group with nothing to open', () => {
    const groups = groupAgentProfileTabOptions([option('statistics')]);

    expect(groups.map((group) => group.key)).toEqual(['general']);
  });
});

describe('webhook tab', () => {
  const base = {
    labels,
    mailSupported: false,
    selfLearningSupported: false,
    shareSupported: false,
    heterogeneous: false,
  };

  it('lists webhooks after channels for an editor where the feature is on', () => {
    const options = buildAgentProfileTabOptions({
      ...base,
      active: 'profile',
      canConfigure: true,
      webhookSupported: true,
    });
    const values = options.map((option) => option.value);
    expect(values.indexOf('webhook')).toBe(values.indexOf('channel') + 1);
    expect(
      groupAgentProfileTabOptions(options)
        .find((group) => group.key === 'identity')
        ?.options.map((option) => option.value),
    ).toEqual(['channel', 'webhook']);
  });

  it('leaves webhooks out while the feature is off or the member cannot edit', () => {
    for (const gate of [
      { canConfigure: true, webhookSupported: false },
      { canConfigure: false, webhookSupported: true },
    ])
      expect(
        buildAgentProfileTabOptions({ ...base, active: 'profile', ...gate }).map((o) => o.value),
      ).not.toContain('webhook');
  });

  it('keeps the tab of the current page even when gated off', () => {
    const options = buildAgentProfileTabOptions({
      ...base,
      active: 'webhook',
      canConfigure: false,
    });
    expect(options.map((option) => option.value)).toContain('webhook');
  });
});

describe('automations tab', () => {
  const base = {
    labels,
    mailSupported: false,
    selfLearningSupported: false,
    shareSupported: false,
    heterogeneous: false,
  };

  it('lists the automations after channels under identity while webhooks are on', () => {
    const options = buildAgentProfileTabOptions({
      ...base,
      active: 'profile',
      automationsSupported: true,
      canConfigure: true,
    });
    expect(
      groupAgentProfileTabOptions(options)
        .find((group) => group.key === 'identity')
        ?.options.map((option) => option.value),
    ).toEqual(['channel', 'automations']);
  });

  it('shows the list to a member who cannot edit the agent too', () => {
    const options = buildAgentProfileTabOptions({
      ...base,
      active: 'statistics',
      automationsSupported: true,
      canConfigure: false,
    });
    expect(options.map((option) => option.value)).toContain('automations');
  });

  it('leaves the tab out while webhooks are off, except on its own page', () => {
    const off = { ...base, canConfigure: true };
    expect(
      buildAgentProfileTabOptions({ ...off, active: 'profile' }).map((option) => option.value),
    ).not.toContain('automations');
    expect(
      buildAgentProfileTabOptions({ ...off, active: 'automations' }).map((option) => option.value),
    ).toContain('automations');
  });
});
