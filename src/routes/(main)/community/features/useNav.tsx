import { Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Blocks, Bot, Brain, BrainCircuit, House } from 'lucide-react';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { type MenuProps } from '@/components/Menu';
import { DiscoverTab } from '@/types/discover';

const ICON_SIZE = 16;

/** Connectors: the MCP catalog plus the connector manager moved here from settings. */
export const MARKETPLACE_CONNECTOR_TAB = 'connector';

export const useNav = () => {
  const location = useLocation();
  const { t } = useTranslation('discover');
  const activeKey = useMemo(() => {
    const pathname = location.pathname;
    // Connectors absorbed the MCP list, so MCP (and legacy plugin) pages light it up.
    if (
      pathname.includes(`/${MARKETPLACE_CONNECTOR_TAB}`) ||
      pathname.includes(`/${DiscoverTab.Mcp}`) ||
      pathname.includes(`/${DiscoverTab.Plugins}`)
    )
      return MARKETPLACE_CONNECTOR_TAB;
    for (const value of Object.values(DiscoverTab)) {
      if (pathname.includes(`/${value}`)) return value;
    }
    return DiscoverTab.Home;
  }, [location.pathname]);

  const items: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={House} size={ICON_SIZE} />,
        key: DiscoverTab.Home,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.home')}</div>,
      },
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
      {
        icon: <Icon icon={Brain} size={ICON_SIZE} />,
        key: DiscoverTab.Models,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.model')}</div>,
      },
      {
        icon: <Icon icon={BrainCircuit} size={ICON_SIZE} />,
        key: DiscoverTab.Providers,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.provider')}</div>,
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
