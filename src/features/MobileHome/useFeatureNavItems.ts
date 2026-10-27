import { FolderClosed, Settings } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { type NavItem, useNavLayout } from '@/hooks/useNavLayout';
import { SidebarTabKey } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

// The tab bar already covers home / chat / community, and the home page has
// its own search bar.
const HIDDEN_KEYS = new Set<string>([
  'search',
  SidebarTabKey.Home,
  SidebarTabKey.Community,
  SidebarTabKey.Chat,
]);

/**
 * The desktop sidebar's destinations (tasks, goals, resources, pages, memory,
 * generation, …) for the mobile home shortcuts. Built from `useNavLayout`, so
 * the lab, feature-flag and workspace rules that hide an item on desktop hide
 * it here too.
 */
export const useFeatureNavItems = (): NavItem[] => {
  const { t } = useTranslation(['common', 'electron']);
  const { topNavItems, bottomMenuItems } = useNavLayout();
  const enableProjects = useUserStore(labPreferSelectors.enableProjects);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  return useMemo(() => {
    const navItems: NavItem[] = [...topNavItems, ...bottomMenuItems].filter(
      (item) => !item.hidden && item.url && !HIDDEN_KEYS.has(item.key),
    );

    if (enableProjects)
      navItems.splice(1, 0, {
        icon: FolderClosed,
        key: 'projects',
        title: t('navigation.projects', { ns: 'electron' }),
        url: '/projects',
      });

    // Personal settings live under the Me tab; a workspace's own settings
    // have no other mobile entry.
    if (activeWorkspaceSlug)
      navItems.push({
        icon: Settings,
        key: SidebarTabKey.Setting,
        title: t('tab.setting'),
        url: '/settings',
      });

    return navItems;
  }, [activeWorkspaceSlug, bottomMenuItems, enableProjects, t, topNavItems]);
};
