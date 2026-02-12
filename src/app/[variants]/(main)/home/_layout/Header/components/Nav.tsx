'use client';

import { Flexbox } from '@lobehub/ui';
import { HomeIcon, SearchIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { getRouteById } from '@/config/routes';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import { type NavItemProps } from '../../../../../../../features/NavPanel/components/NavItem';
import NavItem from '../../../../../../../features/NavPanel/components/NavItem';

interface Item {
  hidden?: boolean | undefined;
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { showMarket, showAiImage } = useServerConfigStore(featureFlagsSelectors);

  const items: Item[] = useMemo(
    () => [
      {
        icon: SearchIcon,
        key: 'search',
        onClick: () => {
          toggleCommandMenu(true);
        },
        title: t('tab.search'),
      },
      {
        icon: HomeIcon,
        key: SidebarTabKey.Home,
        title: t('tab.home'),
        url: '/',
      },
      {
        icon: getRouteById('page')!.icon,
        key: SidebarTabKey.Pages,
        title: t('tab.pages'),
        url: '/page',
      },
      {
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
        title: t('tab.community'),
        url: '/community',
      },
    ],
    [t],
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => {
        const content = (
          <NavItem
            active={tab === item.key}
            hidden={item.hidden}
            icon={item.icon}
            key={item.key}
            title={item.title}
            onClick={item.onClick}
          />
        );
        if (!item.url) return content;

        return (
          <Link
            key={item.key}
            to={item.url}
            onClick={(e) => {
              e.preventDefault();
              item?.onClick?.();
              if (item.url) {
                navigate(item.url);
              }
            }}
          >
            <NavItem
              active={tab === item.key}
              hidden={item.hidden}
              icon={item.icon}
              title={item.title}
            />
          </Link>
        );
      })}
    </Flexbox>
  );
});

export default Nav;
