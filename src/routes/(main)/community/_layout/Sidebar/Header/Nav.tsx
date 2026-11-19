'use client';

import { Flexbox } from '@lobehub/ui';
import { McpIcon, ProviderIcon, SkillsIcon } from '@lobehub/ui/icons';
import { Blocks, Bot, Brain, ShapesIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getMarketplaceSubPath,
  MARKETPLACE_CONNECTOR_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
  MARKETPLACE_PATH,
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

/** Connector management moved here from settings; not a Discover catalog tab. */
const CONNECTOR_TAB = 'connector';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  /** Lists Market content, so it hides when the market is disabled. */
  marketOnly?: boolean;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

// Workspace-aware: `/:slug/marketplace/skill` resolves to `skill` as well.
const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  return getMarketplaceSubPath(pathname) || DiscoverTab.Home;
};

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('discover');
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items: Item[] = useMemo(
    () =>
      [
        {
          icon: ShapesIcon,
          key: DiscoverTab.Home,
          marketOnly: true,
          title: t('tab.home'),
          url: MARKETPLACE_PATH,
        },
        {
          icon: Bot,
          key: DiscoverTab.Assistants,
          marketOnly: true,
          title: t('tab.assistant'),
          url: `${MARKETPLACE_PATH}/agent`,
        },
        {
          icon: SkillsIcon,
          key: DiscoverTab.Skills,
          title: t('tab.skill'),
          // Without the market only the installed view exists.
          url: showMarket ? MARKETPLACE_SKILL_PATH : MARKETPLACE_INSTALLED_SKILLS_PATH,
        },
        {
          icon: Blocks,
          key: CONNECTOR_TAB,
          title: t('tab.connector'),
          url: MARKETPLACE_CONNECTOR_PATH,
        },
        {
          icon: McpIcon,
          key: DiscoverTab.Mcp,
          marketOnly: true,
          title: `MCP`,
          url: `${MARKETPLACE_PATH}/mcp`,
        },
        {
          icon: Brain,
          key: DiscoverTab.Models,
          marketOnly: true,
          title: t('tab.model'),
          url: `${MARKETPLACE_PATH}/model`,
        },
        {
          icon: ProviderIcon,
          key: DiscoverTab.Providers,
          marketOnly: true,
          title: t('tab.provider'),
          url: `${MARKETPLACE_PATH}/provider`,
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
