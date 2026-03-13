'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { HomeIcon, SearchIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { getRouteById } from '@/config/routes';
import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useGlobalStore } from '@/store/global';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isModifierClick } from '@/utils/navigation';

interface Item {
  hidden?: boolean | undefined;
  icon: NavItemProps['icon'];
  isNew?: boolean;
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
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

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
        hidden: !showMarket,
        icon: getRouteById('community')!.icon,
        key: SidebarTabKey.Community,
        title: t('tab.marketplace'),
        url: '/community',
      },
    ],
    [t, showMarket],
  );

  const newBadge = (
    <Tag color="blue" size="small">
      {t('new')}
    </Tag>
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => {
        const extra = item.isNew ? newBadge : undefined;
        const content = (
          <NavItem
            active={tab === item.key}
            extra={extra}
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
              if (isModifierClick(e)) return;
              e.preventDefault();
              item?.onClick?.();
              if (item.url) {
                navigate(item.url);
              }
            }}
          >
            <NavItem
              active={tab === item.key}
              extra={extra}
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
