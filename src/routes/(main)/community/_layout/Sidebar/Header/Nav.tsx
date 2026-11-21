'use client';

import { Flexbox } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Blocks, Bot, Cable } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getMarketplaceSubPath,
  MARKETPLACE_AGENT_PATH,
  MARKETPLACE_APPS_PATH,
  MARKETPLACE_INSTALLED_MCP_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
  MARKETPLACE_MCP_PATH,
  MARKETPLACE_SKILL_PATH,
} from '@/features/Marketplace/paths';
import NavItem from '@/features/NavPanel/components/NavItem';
import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { DiscoverTab } from '@/types/discover';
import { isModifierClick } from '@/utils/navigation';

const APPS_TAB = 'app';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  /** Lists Market content, so it hides when the market is disabled. */
  marketOnly?: boolean;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

const Nav = memo(() => {
  const { pathname } = useActiveLocation();
  const tab = getMarketplaceSubPath(pathname) ?? '';
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items: Item[] = useMemo(
    () =>
      [
        {
          icon: Blocks,
          key: APPS_TAB,
          title: t('tab.apps'),
          url: MARKETPLACE_APPS_PATH,
        },
        {
          icon: SkillsIcon,
          key: DiscoverTab.Skills,
          title: t('tab.skill'),
          // Without the market only the installed view exists.
          url: showMarket ? MARKETPLACE_SKILL_PATH : MARKETPLACE_INSTALLED_SKILLS_PATH,
        },
        {
          icon: Bot,
          key: DiscoverTab.Assistants,
          marketOnly: true,
          title: t('tab.assistant'),
          url: MARKETPLACE_AGENT_PATH,
        },
        {
          icon: Cable,
          key: DiscoverTab.Mcp,
          title: t('tab.mcp'),
          url: showMarket ? MARKETPLACE_MCP_PATH : MARKETPLACE_INSTALLED_MCP_PATH,
        },
      ].filter((item: Item) => showMarket || !item.marketOnly) as Item[],
    [showMarket, t],
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
