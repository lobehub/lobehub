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
});
