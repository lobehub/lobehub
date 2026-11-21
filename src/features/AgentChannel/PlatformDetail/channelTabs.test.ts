import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import { defaultTab, footerSaveHidden, resolveTabs, tabsWithIssues } from './channelTabs';

const schema: FieldSchema[] = [
  { key: 'applicationId', label: 'id', required: true, type: 'string' },
  {
    key: 'credentials',
    label: 'credentials',
    properties: [
      { key: 'botToken', label: 'token', required: true, type: 'password' },
      { key: 'note', label: 'note', type: 'string' },
    ],
    type: 'object',
  },
];

describe('resolveTabs', () => {
  it('always has connect, then the settings tabs the platform has, in page order', () => {
    expect(resolveTabs(['advanced', 'reply', 'wake', 'access'])).toEqual([
      'connect',
      'access',
      'wake',
      'reply',
      'advanced',
    ]);
    expect(resolveTabs(['reply'])).toEqual(['connect', 'reply']);
    expect(resolveTabs([])).toEqual(['connect']);
  });

  it('adds wake records last, only for a saved bot that can wake on its own', () => {
    expect(resolveTabs(['wake', 'reply'], { hasConfig: true })).toEqual([
      'connect',
      'wake',
      'reply',
      'records',
    ]);
    // Not saved yet: nothing has been judged.
    expect(resolveTabs(['wake', 'reply'], { hasConfig: false })).toEqual([
      'connect',
      'wake',
      'reply',
    ]);
    // No wake settings on this platform: it never judges a message.
    expect(resolveTabs(['reply'], { hasConfig: true })).toEqual(['connect', 'reply']);
  });
});

describe('defaultTab', () => {
  it('starts a new channel on connect', () => {
    expect(defaultTab(['connect', 'access', 'reply'], false)).toBe('connect');
  });

  it('opens a saved channel on its first settings tab', () => {
    expect(defaultTab(['connect', 'access', 'reply'], true)).toBe('access');
    expect(defaultTab(['connect', 'reply'], true)).toBe('reply');
  });

  it('never opens on the records tab by itself', () => {
    expect(defaultTab(['connect', 'wake', 'records'], true)).toBe('wake');
  });

  it('stays on connect when there is nothing else', () => {
    expect(defaultTab(['connect'], true)).toBe('connect');
  });
});

describe('tabsWithIssues', () => {
  it('flags connect while a required credential or the app ID is empty', () => {
    expect(tabsWithIssues({}, schema)).toEqual(['connect']);
    expect(tabsWithIssues({ applicationId: '1', credentials: { botToken: ' ' } }, schema)).toEqual([
      'connect',
    ]);
    expect(tabsWithIssues({ credentials: { botToken: 't' } }, schema)).toEqual(['connect']);
  });

  it('is quiet once required values are there, including a stored masked secret', () => {
    expect(
      tabsWithIssues({ applicationId: '1', credentials: { botToken: '••••' } }, schema),
    ).toEqual([]);
  });

  it('flags access when approval is chosen without an owner ID', () => {
    const values = {
      applicationId: '1',
      credentials: { botToken: 't' },
      settings: { dmPolicy: 'pairing' },
    };
    expect(tabsWithIssues(values, schema)).toEqual(['access']);
    expect(
      tabsWithIssues({ ...values, settings: { ...values.settings, userId: '9' } }, schema),
    ).toEqual([]);
  });

  it('lists several tabs in page order', () => {
    expect(tabsWithIssues({ settings: { dmPolicy: 'pairing' } }, schema)).toEqual([
      'connect',
      'access',
    ]);
  });
});

describe('footerSaveHidden', () => {
  it('leaves the save to the setup steps on the Connect tab of a new bot', () => {
    expect(footerSaveHidden({ activeTab: 'connect', hasConfig: false, stepSave: true })).toBe(true);
  });

  it('keeps the bar save where no step offers it', () => {
    // Another tab of a new bot: no step there.
    expect(footerSaveHidden({ activeTab: 'access', hasConfig: false, stepSave: true })).toBe(false);
    // A platform without setup steps (WeChat, iMessage).
    expect(footerSaveHidden({ activeTab: 'connect', hasConfig: false, stepSave: false })).toBe(
      false,
    );
    // A saved bot: the steps fold away and have no save step.
    expect(footerSaveHidden({ activeTab: 'connect', hasConfig: true, stepSave: true })).toBe(false);
  });

  it('has nothing to save on the records tab', () => {
    expect(footerSaveHidden({ activeTab: 'records', hasConfig: true, stepSave: false })).toBe(true);
  });
});
