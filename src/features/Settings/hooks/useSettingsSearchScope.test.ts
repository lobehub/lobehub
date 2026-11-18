import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { type SettingsSearchCategoryGroup, useSettingsSearch } from '@/features/SettingsSearch';
import { SettingsTabs } from '@/store/global/initialState';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';

import { usePersonalSettingsSearchScope } from './useSettingsSearchScope';

const groups: SettingsSearchCategoryGroup[] = [
  {
    items: [
      { key: SettingsTabs.Plans, label: 'Plans' },
      { key: SettingsTabs.Usage, label: 'Usage & Balance' },
      { key: SettingsTabs.Billing, label: 'Billing' },
    ],
    key: 'subscription',
    title: 'Subscription',
  },
];

const search = (query: string) => {
  const { result } = renderHook(
    () => useSettingsSearch(query, usePersonalSettingsSearchScope(groups)),
    {
      wrapper: ({ children }: { children?: ReactNode }) =>
        createElement(ServerConfigStoreProvider, null, children),
    },
  );
  return result.current.results;
};

describe('personal settings search scope', () => {
  it('finds the merged Usage & Balance page by the balance keywords', () => {
    for (const query of ['balance', 'recharge', 'top up']) {
      expect(search(query).map((result) => result.key)).toContain(
        `tab-subscription-${SettingsTabs.Usage}`,
      );
    }
  });

  it('still finds the page by its usage keywords', () => {
    expect(search('consumption').map((result) => result.url)).toContain('/settings/usage');
  });
});
