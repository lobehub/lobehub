'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useNavLayout } from '@/hooks/useNavLayout';
import { isModifierClick } from '@/utils/navigation';

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { topNavItems } = useNavLayout();
  const items = useMemo(
    () =>
      topNavItems.map((item) =>
        item.key === 'search' || item.key === 'community' ? { ...item, hidden: true } : item,
      ),
    [topNavItems],
  );
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items: Item[] = useMemo(
    () => [
      {
        hidden: true,
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
        hidden: true,
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
            icon={item.icon as NavItemProps['icon']}
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
              icon={item.icon as NavItemProps['icon']}
              title={item.title}
            />
          </Link>
        );
      })}
    </Flexbox>
  );
});

export default Nav;
