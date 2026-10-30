import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useSettingsSearch } from '@/features/SettingsSearch';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import { type WorkspaceSettingCategoryGroup, WorkspaceSettingsGroupKey } from './useCategory';
import { useWorkspaceSettingsSearchScope } from './useSettingsSearchScope';

const memberGroups: WorkspaceSettingCategoryGroup[] = [
  {
    items: [
      { icon: null, key: WorkspaceSettingsTabs.Profile, label: 'Profile' },
      { icon: null, key: WorkspaceSettingsTabs.ChatPreference, label: 'Chat Preferences' },
    ],
    key: WorkspaceSettingsGroupKey.Account,
    title: 'Account',
  },
  {
    items: [
      { icon: null, key: WorkspaceSettingsTabs.Members, label: 'Members' },
      { icon: null, key: WorkspaceSettingsTabs.Stats, label: 'Statistics' },
      { icon: null, key: WorkspaceSettingsTabs.Notification, label: 'Notifications' },
    ],
    key: WorkspaceSettingsGroupKey.General,
    title: 'Workspace',
  },
];

const adminGroups: WorkspaceSettingCategoryGroup[] = [
  ...memberGroups,
  {
    items: [
      { icon: null, key: WorkspaceSettingsTabs.Provider, label: 'AI Providers' },
      { icon: null, key: WorkspaceSettingsTabs.ServiceModel, label: 'Service Model' },
    ],
    key: WorkspaceSettingsGroupKey.Agent,
    title: 'Agent',
  },
];

const search = (query: string, groups: WorkspaceSettingCategoryGroup[]) => {
  const { result } = renderHook(
    () => {
      const scope = useWorkspaceSettingsSearchScope('acme', groups);
      return useSettingsSearch(query, scope);
    },
    {
      wrapper: ({ children }: { children?: ReactNode }) =>
        createElement(ServerConfigStoreProvider, null, children),
    },
  );
  return result.current.results;
};

describe('workspace settings search scope', () => {
  it('links workspace-only tabs under the workspace slug', () => {
    expect(search('members', memberGroups)[0]).toMatchObject({
      url: '/acme/settings/members',
    });
  });

  it('matches the personal stats keywords on the workspace statistics tab', () => {
    expect(search('analytics', memberGroups).map((result) => result.url)).toContain(
      '/acme/settings/statistics',
    );
  });

  it('deep-links follow-up suggestions to the chat preferences row for members', () => {
    const urls = search('follow up', memberGroups).map((result) => result.url);

    expect(urls).toContain('/acme/settings/chat-preference#chat-preference-followUpAction');
    // Service Model is admin-only: hidden from the sidebar, so not searchable
    expect(urls.some((url) => url.includes('service-model'))).toBe(false);
  });

  it('sends admins searching follow-up only to chat preferences', () => {
    const urls = search('follow up', adminGroups).map((result) => result.url);

    expect(urls).toContain('/acme/settings/chat-preference#chat-preference-followUpAction');
    // The workspace Service Model page no longer renders these rows
    expect(urls.some((url) => url.includes('service-model'))).toBe(false);
  });

  it('keeps admin-only tabs searchable for admins', () => {
    const urls = search('prompt rewrite', adminGroups).map((result) => result.url);

    expect(urls).toContain('/acme/settings/service-model#service-model-advanced');
    expect(search('openai', adminGroups).map((result) => result.url)).toContain(
      '/acme/settings/provider/openai',
    );
  });

  it('indexes only the tab for workspace pages that differ from the personal ones', () => {
    const results = search('notification', memberGroups);

    expect(results.map((result) => result.key)).toContain(
      `tab-${WorkspaceSettingsGroupKey.General}-${WorkspaceSettingsTabs.Notification}`,
    );
    expect(results.some((result) => result.key.startsWith('item-notification'))).toBe(false);
  });
});
