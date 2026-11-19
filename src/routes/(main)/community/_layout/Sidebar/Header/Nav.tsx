'use client';

import { Flexbox } from '@lobehub/ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import { Bot } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { DiscoverTab } from '@/types/discover';
import { isModifierClick } from '@/utils/navigation';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  return (pathname.split('/community/').at(1) as DiscoverTab) || DiscoverTab.Assistants;
};

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');

  const items: Item[] = useMemo(
    () =>
      [
        {
          icon: Bot,
          key: DiscoverTab.Assistants,
          title: t('tab.assistant'),
          url: '/community/agent',
        },
        {
          icon: SkillsIcon,
          key: DiscoverTab.Skills,
          title: t('tab.skill'),
          url: '/community/skill',
        },
        {
          icon: McpIcon,
          key: DiscoverTab.Mcp,
          title: t('tab.connector'),
          url: '/community/mcp',
        },
        // Models / Model Providers are hidden, not deleted: see
        // `@/spa/router/communityHiddenRoutes` for the restore path.
      ] as Item[],
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
          <WorkspaceLink
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
            <NavItem active={tab.startsWith(item.key)} icon={item.icon} title={item.title} />
          </WorkspaceLink>
        );
      })}
    </Flexbox>
  );
});

export default Nav;
