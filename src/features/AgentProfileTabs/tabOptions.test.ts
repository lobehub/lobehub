import { describe, expect, it } from 'vitest';

import {
  type AgentProfileTab,
  buildAgentProfileTabOptions,
  buildAgentProfileTabPath,
  getAgentProfileTab,
  groupAgentProfileTabOptions,
} from './tabOptions';

const labels = {
  'channel': 'tab.integration',
  'mail': 'tab.mail',
  'profile': 'tab.profile',
  'self-evolving': 'title',
  'share': 'share',
  'statistics': 'usageStats.title',
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
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: false,
    });

    expect(options.map((option) => option.value)).toEqual(['profile', 'channel', 'statistics']);
  });

  it('drops the config tabs for a member without edit access', () => {
    const options = buildAgentProfileTabOptions({
      active: 'statistics',
      canConfigure: false,
      labels,
      mailSupported: false,
      selfLearningSupported: false,
      shareSupported: true,
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
    });

    expect(options.map((option) => option.value)).toEqual([
      'profile',
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
    });

    expect(options.map((option) => option.value)).toEqual(['statistics']);
  });
});

describe('groupAgentProfileTabOptions', () => {
  const option = (value: AgentProfileTab) => ({
    label: value,
    value,
  });

  it('keeps the profile on top and puts mail and IM bots under identity', () => {
    const groups = groupAgentProfileTabOptions(
      (['profile', 'mail', 'channel', 'self-evolving', 'statistics', 'share'] as const).map(option),
    );

    expect(groups.map((group) => [group.key, group.options.map((item) => item.value)])).toEqual([
      ['profile', ['profile']],
      ['identity', ['mail', 'channel']],
      ['general', ['self-evolving', 'statistics', 'share']],
    ]);
  });

  it('leaves out a group with nothing to open', () => {
    const groups = groupAgentProfileTabOptions([option('statistics')]);

    expect(groups.map((group) => group.key)).toEqual(['general']);
  });
});
