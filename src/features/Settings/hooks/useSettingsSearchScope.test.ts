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
      { key: SettingsTabs.Appearance, label: 'Appearance' },
      { key: SettingsTabs.Conversation, label: 'Conversation' },
      { key: SettingsTabs.Hotkey, label: 'Hotkeys' },
    ],
    key: 'account',
    title: 'Account',
  },
  {
    items: [{ key: SettingsTabs.ServiceModel, label: 'Service Model' }],
    key: 'agent',
    title: 'Agent',
  },
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

  it('sends follow-up searches to the Conversation page, not Service Model', () => {
    const urls = search('follow up').map((result) => result.url);

    expect(urls).toContain('/settings/conversation#conversation-followUpAction');
    expect(urls.some((url) => url.includes('service-model'))).toBe(false);
  });

  it('finds the moved conversation settings on the Conversation page', () => {
    expect(search('send key').map((result) => result.url)).toContain(
      '/settings/conversation#conversation-send-key',
    );
    expect(search('response language').map((result) => result.url)).toContain(
      '/settings/conversation#conversation-response-language',
    );
    expect(search('response language').map((result) => result.url)).not.toContain(
      '/settings/appearance#appearance-response-language',
    );
  });
});
