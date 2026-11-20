import { Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Blocks, Bot } from 'lucide-react';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { type MenuProps } from '@/components/Menu';
import { getMarketplaceSubPath } from '@/features/Marketplace/paths';
import { DiscoverTab } from '@/types/discover';

const ICON_SIZE = 16;

/** Connectors: the MCP catalog plus the connector manager moved here from settings. */
export const MARKETPLACE_CONNECTOR_TAB = 'connector';

export const useNav = () => {
  const location = useLocation();
  const { t } = useTranslation('discover');
  const activeKey = useMemo(() => {
    const section = getMarketplaceSubPath(location.pathname)?.split('/')[0];
    // MCP and legacy plugin details belong to Connectors.
    if (section === DiscoverTab.Mcp || section === DiscoverTab.Plugins)
      return MARKETPLACE_CONNECTOR_TAB;
    return section;
  }, [location.pathname]);

  const items: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={Bot} size={ICON_SIZE} />,
        key: DiscoverTab.Assistants,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.assistant')}</div>,
      },
      {
        icon: <Icon icon={SkillsIcon} size={ICON_SIZE} />,
        key: DiscoverTab.Skills,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.skill')}</div>,
      },
      {
        icon: <Icon icon={Blocks} size={ICON_SIZE} />,
        key: MARKETPLACE_CONNECTOR_TAB,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.connector')}</div>,
      },
    ],
    [t],
  );

  const activeItem = items.find((item: any) => item.key === activeKey) as {
    icon: ReactNode;
    key: string;
    label: string;
  };

  return {
    activeItem,
    activeKey,
    items,
  };
};
