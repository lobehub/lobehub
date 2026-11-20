import { HomeIcon, SearchIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getRouteById } from '@/config/routes';
import { getMarketplaceEntryPath, MARKETPLACE_SEGMENT } from '@/features/Marketplace/paths';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

export interface NavItem {
  /** First path segment that marks this item active, when it differs from `key`. */
  activeTab?: string;
  additionalActiveTabs?: string[];
  hidden?: boolean;
  icon: any;
  isNew?: boolean;
  key: string;
  onClick?: () => void;
  title: string;
  url?: string;
}

export interface NavLayout {
  bottomMenuItems: NavItem[];
  footer: {
    hideGitHub: boolean;
    layout: 'expanded' | 'compact';
    showEvalEntry: boolean;
    showSettingsEntry: boolean;
  };
  topNavItems: NavItem[];
  userPanel: {
    showDataImporter: boolean;
    showMemory: boolean;
  };
}

export const useNavLayout = (): NavLayout => {
  const { t } = useTranslation(['common', 'chat']);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { showMarket, hideGitHub } = useServerConfigStore(featureFlagsSelectors);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const enableDashboard = useServerConfigStore(serverConfigSelectors.enableDashboard);
  const enableProjects = useUserStore(labPreferSelectors.enableProjects);

  const topNavItems = useMemo(
    () =>
      [
        {
          icon: SearchIcon,
          key: 'search',
          onClick: () => toggleCommandMenu(true),
          title: t('tab.search'),
        },
        {
          icon: HomeIcon,
          key: SidebarTabKey.Home,
          title: t('tab.home'),
          url: '/',
        },
        {
          icon: getRouteById('tasks')!.icon,
          additionalActiveTabs: activeWorkspaceSlug ? undefined : ['goals', 'goal', 'task'],
          key: SidebarTabKey.Tasks,
          title: activeWorkspaceSlug ? t('tab.tasks') : t('tab.goalsAndTasks', { ns: 'chat' }),
          url: '/tasks',
        },
        ...(activeWorkspaceSlug
          ? [
              {
                icon: getRouteById('goals')!.icon,
                key: SidebarTabKey.Goals,
                title: t('tab.goals'),
                url: '/goals',
              },
            ]
          : []),
        {
          // Keyed `project` to match the sidebar layout id; the page is `/projects`.
          activeTab: 'projects',
          hidden: !enableProjects,
          icon: getRouteById('project')!.icon,
          key: 'project',
          title: t('tab.projects'),
          url: '/projects',
        },
        {
          // Personal boards only for now — workspace-level boards have no UI
          // yet — and only while the `dashboard` feature flag is on.
          hidden: !!activeWorkspaceSlug || !enableDashboard,
          icon: getRouteById('dashboard')!.icon,
          key: SidebarTabKey.Dashboard,
          title: t('tab.dashboard'),
          url: '/dashboard',
        },
        {
          icon: getRouteById('resource')!.icon,
          key: SidebarTabKey.Resource,
          title: t('tab.resource'),
          url: '/resource',
        },
      ] as NavItem[],
    [t, toggleCommandMenu, activeWorkspaceSlug, enableDashboard, enableProjects],
  );

  const bottomMenuItems = useMemo(
    () =>
      [
        {
          icon: getRouteById('image')!.icon,
          key: SidebarTabKey.Image,
          title: t('tab.generation'),
          url: '/image',
        },
        // Always shown: installed skills and connectors live in the Marketplace,
        // so with the market off the entry opens straight on the installed skills.
        {
          activeTab: MARKETPLACE_SEGMENT,
          icon: getRouteById('community')!.icon,
          key: SidebarTabKey.Community,
          title: t('tab.marketplace'),
          url: getMarketplaceEntryPath(showMarket),
        },
        {
          hidden: !!activeWorkspaceSlug,
          icon: getRouteById('memory')!.icon,
          key: SidebarTabKey.Memory,
          title: t('tab.memory'),
          url: '/memory',
        },
      ] as NavItem[],
    [t, showMarket, activeWorkspaceSlug],
  );

  const footer = useMemo(
    () => ({
      hideGitHub: !!hideGitHub,
      layout: 'compact' as const,
      showEvalEntry: false,
      showSettingsEntry: true,
    }),
    [hideGitHub],
  );

  const userPanel = useMemo(
    () => ({
      showDataImporter: false,
      // Memory now appears in the sidebar by default; drop the duplicate entry
      // from the user dropdown to keep that menu focused on account / settings.
      showMemory: false,
    }),
    [],
  );

  return { bottomMenuItems, footer, topNavItems, userPanel };
};
