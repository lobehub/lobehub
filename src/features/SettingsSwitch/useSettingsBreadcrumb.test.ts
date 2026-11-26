import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  rememberSettingsTab,
  resetRememberedSettingsTabs,
  type ScopedSettingsGroup,
} from './settingsScope';
import { useSettingsBreadcrumb } from './useSettingsBreadcrumb';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      ({
        'settingsSwitch.account': 'Account Settings',
        'settingsSwitch.personalSpace': 'Personal Space Settings',
        'settingsSwitch.workspace': `${options?.name} Settings`,
      })[key] ?? key,
  }),
}));

const groups: ScopedSettingsGroup[] = [
  { items: [{ key: 'profile' }, { key: 'appearance' }], scope: 'account' },
  { items: [{ key: 'general' }, { key: 'members' }], scope: 'space' },
];

const workspace = { kind: 'workspace', name: 'LobeHub' } as const;
const tabUrl = (tab: string) => `/acme/settings/${tab}`;

afterEach(() => {
  resetRememberedSettingsTabs();
});

describe('useSettingsBreadcrumb', () => {
  it('names the space as the root in the space set', () => {
    const { result } = renderHook(() =>
      useSettingsBreadcrumb({
        activeTab: 'general',
        fallbackHref: '/acme/settings',
        groups,
        scope: 'space',
        space: workspace,
        spaceKey: 'acme',
        tabUrl,
      }),
    );

    expect(result.current).toEqual([{ href: '/acme/settings/general', title: 'LobeHub Settings' }]);
  });

  it('puts account settings under the space, whose root leads back to the tab left', () => {
    rememberSettingsTab('acme', 'space', 'members');
    rememberSettingsTab('acme', 'account', 'appearance');

    const { result } = renderHook(() =>
      useSettingsBreadcrumb({
        activeTab: 'appearance',
        fallbackHref: '/acme/settings',
        groups,
        scope: 'account',
        space: workspace,
        spaceKey: 'acme',
        tabUrl,
      }),
    );

    expect(result.current).toEqual([
      { href: '/acme/settings/members', title: 'LobeHub Settings' },
      { href: '/acme/settings/appearance', title: 'Account Settings' },
    ]);
  });

  it('names the personal space and falls back when its set lists no tab', () => {
    const { result } = renderHook(() =>
      useSettingsBreadcrumb({
        activeTab: 'profile',
        fallbackHref: '/settings',
        groups: groups.filter((group) => group.scope === 'account'),
        scope: 'account',
        space: { kind: 'personal' },
        spaceKey: 'personal',
        tabUrl: (tab) => `/settings/${tab}`,
      }),
    );

    expect(result.current).toEqual([
      { href: '/settings', title: 'Personal Space Settings' },
      { href: '/settings/profile', title: 'Account Settings' },
    ]);
  });

  // Moving General → Members only remembers Members in an effect after the
  // render; the crumb must not keep pointing at General meanwhile.
  it('points the visible set at the tab on screen, not the one remembered before it', () => {
    rememberSettingsTab('acme', 'space', 'general');
    rememberSettingsTab('acme', 'account', 'profile');

    const { result: space } = renderHook(() =>
      useSettingsBreadcrumb({
        activeTab: 'members',
        fallbackHref: '/acme/settings',
        groups,
        scope: 'space',
        space: workspace,
        spaceKey: 'acme',
        tabUrl,
      }),
    );
    const { result: account } = renderHook(() =>
      useSettingsBreadcrumb({
        activeTab: 'appearance',
        fallbackHref: '/acme/settings',
        groups,
        scope: 'account',
        space: workspace,
        spaceKey: 'acme',
        tabUrl,
      }),
    );

    expect(space.current[0].href).toBe('/acme/settings/members');
    expect(account.current.map((item) => item.href)).toEqual([
      '/acme/settings/general',
      '/acme/settings/appearance',
    ]);
  });
});
