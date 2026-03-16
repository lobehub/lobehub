import { HomeIcon, SearchIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

export interface NavItem {
  /**
   * true = dev mode only, false = simplified mode only, undefined = always
   */
  devOnly?: boolean;
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

const filterByMode = (items: NavItem[], isDevMode: boolean): NavItem[] =>
  items.filter((item) => item.devOnly === undefined || item.devOnly === isDevMode);

export const useNavLayout = (): NavLayout => {
  const { t } = useTranslation('common');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { showMarket, showAiImage, hideGitHub } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  const topNavItems = useMemo(
    () =>
      filterByMode(
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
            devOnly: true,
            icon: getRouteById('page')!.icon,
            key: SidebarTabKey.Pages,
            title: t('tab.pages'),
            url: '/page',
          },
          {
            devOnly: true,
            hidden: !enableBusinessFeatures,
            icon: getRouteById('video')!.icon,
            key: SidebarTabKey.Video,
            title: t('tab.video'),
            url: '/video',
          },
          {
            devOnly: true,
            hidden: !showAiImage,
            icon: getRouteById('image')!.icon,
            key: SidebarTabKey.Image,
            title: t('tab.aiImage'),
            url: '/image',
          },
          {
            hidden: !showMarket,
            icon: getRouteById('community')!.icon,
            key: SidebarTabKey.Community,
            title: t('tab.marketplace'),
            url: '/community',
          },
        ],
        isDevMode,
      ),
    [t, toggleCommandMenu, showMarket, isDevMode, enableBusinessFeatures, showAiImage],
  );

  const bottomMenuItems = useMemo(
    () =>
      filterByMode(
        [
          {
            devOnly: true,
            icon: getRouteById('settings')!.icon,
            key: SidebarTabKey.Setting,
            title: t('tab.setting'),
            url: '/settings',
          },
          {
            icon: getRouteById('resource')!.icon,
            key: SidebarTabKey.Resource,
            title: t('tab.resource'),
            url: '/resource',
          },
          {
            devOnly: true,
            icon: getRouteById('memory')!.icon,
            key: SidebarTabKey.Memory,
            title: t('tab.memory'),
            url: '/memory',
          },
          {
            devOnly: false,
            icon: getRouteById('page')!.icon,
            key: SidebarTabKey.Pages,
            title: t('tab.pages'),
            url: '/page',
          },
        ],
        isDevMode,
      ),
    [t, isDevMode],
  );

  const footer = useMemo(
    () => ({
      hideGitHub: !!hideGitHub,
      layout: (isDevMode ? 'expanded' : 'compact') as 'expanded' | 'compact',
      showEvalEntry: isDevMode,
      showSettingsEntry: !isDevMode,
    }),
    [isDevMode, hideGitHub],
  );

  const userPanel = useMemo(
    () => ({
      showDataImporter: isDevMode,
      showMemory: !isDevMode,
    }),
    [isDevMode],
  );

  return { bottomMenuItems, footer, topNavItems, userPanel };
};
