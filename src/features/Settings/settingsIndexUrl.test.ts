import { describe, expect, it } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { getSettingsIndexUrl } from './settingsIndexUrl';

const item = (key: SettingsTabs, href?: string) => ({ href, icon: undefined, key, label: key });

const groups = [
  { items: [item(SettingsTabs.Profile)], scope: 'account' as const },
  { items: [item(SettingsTabs.Plans), item(SettingsTabs.Usage)], scope: 'space' as const },
  { items: [item(SettingsTabs.Provider)], scope: 'space' as const },
];

describe('getSettingsIndexUrl', () => {
  // `/settings` used to open account settings (Profile); it now leads with
  // the personal space's own settings.
  it('opens the personal space set on its first tab, not Profile', () => {
    expect(getSettingsIndexUrl(groups)).toBe('/settings/plans');
  });

  it('opens the provider list when Provider is the first space tab', () => {
    expect(getSettingsIndexUrl(groups.slice(0, 1).concat(groups.slice(2)))).toBe(
      '/settings/provider/all',
    );
  });

  it('skips a link out of the space', () => {
    const withLink = [
      {
        items: [item(SettingsTabs.Plans, '/elsewhere'), item(SettingsTabs.Usage)],
        scope: 'space' as const,
      },
    ];

    expect(getSettingsIndexUrl(withLink)).toBe('/settings/usage');
  });

  it('falls back to Profile when the space lists no tab', () => {
    expect(getSettingsIndexUrl(groups.slice(0, 1))).toBe('/settings/profile');
    expect(getSettingsIndexUrl([])).toBe('/settings/profile');
  });
});
