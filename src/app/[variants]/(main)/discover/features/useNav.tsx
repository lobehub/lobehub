import { MCP } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { Bot, Brain, BrainCircuit, House } from 'lucide-react';
import { ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import type { MenuProps } from '@/components/Menu';
import { DiscoverTab } from '@/types/discover';

const ICON_SIZE = 16;

export const useNav = () => {
  const location = useLocation();
  const { t } = useTranslation('discover');

  const activeKey = useMemo(() => {
    const pathname = location.pathname;
    for (const value of Object.values(DiscoverTab)) {
      if (pathname.includes(`/${DiscoverTab.Plugins}`)) {
        return DiscoverTab.Mcp;
      } else if (pathname.includes(`/${value}`)) {
        return value;
      }
    }
    return DiscoverTab.Home;
  }, [location.pathname]);

  const items: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={House} size={ICON_SIZE} />,
        key: DiscoverTab.Home,
        label: (
          <Link style={{ color: 'inherit' }} to={'/'}>
            {t('tab.home')}
          </Link>
        ),
      },
      {
        icon: <Icon icon={Bot} size={ICON_SIZE} />,
        key: DiscoverTab.Assistants,
        label: (
          <Link style={{ color: 'inherit' }} to={`/${DiscoverTab.Assistants}`}>
            {t('tab.assistant')}
          </Link>
        ),
      },
      {
        icon: <MCP className={'anticon'} size={ICON_SIZE} />,
        key: DiscoverTab.Mcp,
        label: (
          <Link style={{ color: 'inherit' }} to={`/${DiscoverTab.Mcp}`}>
            {`MCP ${t('tab.plugin')}`}
          </Link>
        ),
      },
      {
        icon: <Icon icon={Brain} size={ICON_SIZE} />,
        key: DiscoverTab.Models,
        label: (
          <Link style={{ color: 'inherit' }} to={`/${DiscoverTab.Models}`}>
            {t('tab.model')}
          </Link>
        ),
      },
      {
        icon: <Icon icon={BrainCircuit} size={ICON_SIZE} />,
        key: DiscoverTab.Providers,
        label: (
          <Link style={{ color: 'inherit' }} to={`/${DiscoverTab.Providers}`}>
            {t('tab.provider')}
          </Link>
        ),
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
