'use client';

import { Flexbox } from '@lobehub/ui';
import { McpIcon, ProviderIcon } from '@lobehub/ui/icons';
import { Bot, Brain, ShapesIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { usePathname } from '@/libs/router/navigation';
import { DiscoverTab } from '@/types/discover';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

const useActiveTabKey = () => {
  const pathname = usePathname();
  if (pathname === '/community') return DiscoverTab.Home;
  return (pathname.split('/community/').find(Boolean)! as DiscoverTab) || DiscoverTab.Home;
};

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { t } = useTranslation('discover');

  const items: Item[] = useMemo(
    () => [
      {
        icon: ShapesIcon,
        key: DiscoverTab.Home,
        title: t('tab.home'),
        url: '/community',
      },
      {
        icon: Bot,
        key: DiscoverTab.Assistants,
        title: t('tab.assistant'),
        url: '/community/agent',
      },
      {
        icon: McpIcon,
        key: DiscoverTab.Mcp,
        title: `MCP`,
        url: '/community/mcp',
      },
      {
        icon: Brain,
        key: DiscoverTab.Models,
        title: t('tab.model'),
        url: '/community/model',
      },
      {
        icon: ProviderIcon,
        key: DiscoverTab.Providers,
        title: t('tab.provider'),
        url: '/community/provider',
      },
    ],
    [t],
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => {
        const content = (
          <NavItem
            active={tab.startsWith(item.key)}
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
            <NavItem active={tab.startsWith(item.key)} icon={item.icon} title={item.title} />
          </Link>
        );
      })}
    </Flexbox>
  );
});

export default Nav;
