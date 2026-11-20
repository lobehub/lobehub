import { useMemo } from 'react';

import type { SettingsSearchScope, SettingsSearchTab } from '@/features/SettingsSearch';
import { SettingsTabs } from '@/store/global/initialState';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import type { WorkspaceSettingCategoryGroup } from './useCategory';

/**
 * Workspace tabs whose page is the personal settings page (or renders the same
 * anchored rows), so item-level search results can deep-link into them.
 * Billing, credits, storage, notification, … render workspace-specific pages
 * and only get tab-level entries.
 */
const ITEM_TABS: ReadonlySet<SettingsSearchTab> = new Set<SettingsSearchTab>([
  SettingsTabs.Advanced,
  SettingsTabs.Appearance,
  SettingsTabs.Connector,
  SettingsTabs.Hotkey,
  SettingsTabs.Labs,
  SettingsTabs.Profile,
  SettingsTabs.Provider,
  SettingsTabs.ServiceModel,
  WorkspaceSettingsTabs.ChatPreference,
]);

/**
 * Follow-up / input completion live on Chat Preferences here; the workspace
 * Service Model page hides them, so its keywords must not match them either.
 */
const KEYWORD_OWNER_TABS: readonly SettingsSearchTab[] = [WorkspaceSettingsTabs.ChatPreference];

/** Workspace tab keys whose value differs from the matching personal tab */
const SEARCH_TAB_ALIASES: Partial<Record<WorkspaceSettingsTabs, SettingsSearchTab>> = {
  [WorkspaceSettingsTabs.Stats]: SettingsTabs.Stats,
};

export const getWorkspaceSettingsTabUrl = (slug: string, tab: WorkspaceSettingsTabs) =>
  `/${slug}/settings/${tab}`;

/**
 * Settings-search scope for the workspace sidebar: indexes exactly the tabs
 * the sidebar shows (inheriting its permission gating), linking into
 * `/:slug/settings/*`.
 */
export const useWorkspaceSettingsSearchScope = (
  slug: string | null | undefined,
  groups: WorkspaceSettingCategoryGroup[],
): SettingsSearchScope =>
  useMemo(
    () => ({
      categoryGroups: groups.map((group) => ({
        items: group.items.map((item) => ({
          href: slug ? getWorkspaceSettingsTabUrl(slug, item.key) : undefined,
          icon: item.icon,
          key: SEARCH_TAB_ALIASES[item.key] ?? item.key,
          label: item.label,
        })),
        key: group.key,
        title: group.title,
      })),
      itemTabs: ITEM_TABS,
      keywordOwnerTabs: KEYWORD_OWNER_TABS,
      providerUrl: (providerId: string) => `/${slug}/settings/provider/${providerId}`,
    }),
    [groups, slug],
  );
