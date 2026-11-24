import { useCallback, useMemo } from 'react';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useSettingsScopeSwitch } from '@/features/SettingsSwitch/useSettingsScopeSwitch';
import { type SettingsSpace } from '@/features/SettingsSwitch/useSettingsScopeTitle';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { DEFAULT_WORKSPACE_SETTINGS_TAB, WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import { useWorkspaceSettingCategory, type WorkspaceSettingCategoryItem } from './useCategory';
import { getWorkspaceSettingsTabUrl } from './useSettingsSearchScope';

const WORKSPACE_TABS = new Set<string>(Object.values(WorkspaceSettingsTabs));

/**
 * Active tab of `/:slug/settings/*` and which settings set it belongs to: the
 * account set or this workspace's set.
 */
export const useWorkspaceSettingsScope = () => {
  const groups = useWorkspaceSettingCategory();
  const location = useActiveLocation();
  const slug = useActiveWorkspaceSlug();
  const workspace = useActiveWorkspace();

  const activeTab = useMemo(() => {
    if (!slug) return DEFAULT_WORKSPACE_SETTINGS_TAB;
    const tab = location.pathname.split('/').filter(Boolean)[2];
    return tab && WORKSPACE_TABS.has(tab)
      ? (tab as WorkspaceSettingsTabs)
      : DEFAULT_WORKSPACE_SETTINGS_TAB;
  }, [location.pathname, slug]);

  // A personal-only account tab carries the personal page it opens.
  const tabUrl = useCallback(
    (tab: WorkspaceSettingCategoryItem['key']) =>
      groups.flatMap((group) => group.items).find((item) => item.key === tab)?.href ??
      getWorkspaceSettingsTabUrl(slug ?? '', tab as WorkspaceSettingsTabs),
    [groups, slug],
  );

  const scopeSwitch = useSettingsScopeSwitch({
    activeTab,
    groups,
    spaceKey: slug ?? '',
    tabUrl,
  });

  const space: SettingsSpace = useMemo(
    () => ({
      avatar: workspace?.avatar,
      kind: 'workspace',
      name: workspace?.name ?? slug ?? '',
    }),
    [workspace?.avatar, workspace?.name, slug],
  );

  return { ...scopeSwitch, activeTab, groups, slug, space, tabUrl };
};
