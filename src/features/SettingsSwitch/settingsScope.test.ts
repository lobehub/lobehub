import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  filterGroupsByScope,
  getActiveSettingsScope,
  getSettingsScopeEntryTab,
  rememberSettingsTab,
  resetRememberedSettingsTabs,
  type ScopedSettingsGroup,
} from './settingsScope';
import { useSettingsScopeSwitch } from './useSettingsScopeSwitch';

const groups: ScopedSettingsGroup[] = [
  { items: [{ key: 'profile' }, { key: 'appearance' }], scope: 'account' },
  { items: [{ key: 'labs' }], scope: 'account' },
  { items: [{ key: 'general' }, { key: 'members' }], scope: 'space' },
  { items: [{ key: 'devices' }], scope: 'space' },
];

const tabUrl = (tab: string) => `/acme/settings/${tab}`;

afterEach(() => {
  resetRememberedSettingsTabs();
});

describe('getActiveSettingsScope', () => {
  it('puts account tabs in the account set', () => {
    expect(getActiveSettingsScope(groups, 'appearance')).toBe('account');
    expect(getActiveSettingsScope(groups, 'labs')).toBe('account');
  });

  it('puts space tabs and unlisted tabs in the space set', () => {
    expect(getActiveSettingsScope(groups, 'members')).toBe('space');
    // e.g. a sub-page or a tab hidden by a permission
    expect(getActiveSettingsScope(groups, 'unknown')).toBe('space');
    expect(getActiveSettingsScope(groups, undefined)).toBe('space');
  });
});

describe('links out of the space', () => {
  // A workspace lists the personal Notifications page in its account set; the
  // key repeats the workspace's own Notifications tab.
  const withLink: ScopedSettingsGroup[] = [
    {
      items: [{ key: 'profile' }, { href: '/settings/notification', key: 'notification' }],
      scope: 'account',
    },
    { items: [{ key: 'general' }, { key: 'notification' }], scope: 'space' },
  ];

  it('keeps the workspace tab with a repeated key in the space set', () => {
    expect(getActiveSettingsScope(withLink, 'notification')).toBe('space');
  });

  it('never makes a link the remembered or entry tab', () => {
    rememberSettingsTab('acme', 'account', 'notification');

    expect(getSettingsScopeEntryTab('acme', 'account', withLink)).toBe('profile');
  });
});

describe('filterGroupsByScope', () => {
  it('keeps only the groups of one set, so no tab shows in both sidebars', () => {
    const account = filterGroupsByScope(groups, 'account').flatMap((g) => g.items);
    const space = filterGroupsByScope(groups, 'space').flatMap((g) => g.items);

    expect(account.map((item) => item.key)).toEqual(['profile', 'appearance', 'labs']);
    expect(space.map((item) => item.key)).toEqual(['general', 'members', 'devices']);
  });
});

describe('getSettingsScopeEntryTab', () => {
  it('opens a set on its first tab before it was visited', () => {
    expect(getSettingsScopeEntryTab('acme', 'space', groups)).toBe('general');
    expect(getSettingsScopeEntryTab('acme', 'account', groups)).toBe('profile');
  });

  it('returns to the tab last visited in that set', () => {
    rememberSettingsTab('acme', 'space', 'devices');

    expect(getSettingsScopeEntryTab('acme', 'space', groups)).toBe('devices');
  });

  it('remembers each space separately', () => {
    rememberSettingsTab('acme', 'space', 'devices');

    expect(getSettingsScopeEntryTab('personal', 'space', groups)).toBe('general');
  });

  it('falls back to the first tab when the remembered one is no longer listed', () => {
    rememberSettingsTab('acme', 'space', 'billing');

    expect(getSettingsScopeEntryTab('acme', 'space', groups)).toBe('general');
  });
});

describe('useSettingsScopeSwitch', () => {
  it('round-trips between the two sets and lands back on the tab left', () => {
    const { rerender, result } = renderHook(
      (activeTab: string) =>
        useSettingsScopeSwitch({ activeTab, groups, spaceKey: 'acme', tabUrl }),
      { initialProps: 'devices' },
    );

    expect(result.current.scope).toBe('space');
    expect(result.current.scopeGroups.every((group) => group.scope === 'space')).toBe(true);
    expect(result.current.switchUrl).toBe('/acme/settings/profile');

    // Click the card → account settings, then move to Appearance.
    rerender('profile');
    rerender('appearance');

    expect(result.current.scope).toBe('account');
    // The card leads back to the space tab the user left.
    expect(result.current.switchUrl).toBe('/acme/settings/devices');

    // And back again: the account card now returns to Appearance.
    rerender('devices');

    expect(result.current.switchUrl).toBe('/acme/settings/appearance');
  });

  it('hides the card when the other set has no tab', () => {
    const accountOnly = groups.filter((group) => group.scope === 'account');
    const { result } = renderHook(() =>
      useSettingsScopeSwitch({
        activeTab: 'profile',
        groups: accountOnly,
        spaceKey: 'acme',
        tabUrl,
      }),
    );

    expect(result.current.switchUrl).toBeUndefined();
  });
});
