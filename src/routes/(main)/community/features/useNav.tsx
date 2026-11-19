import { MCP } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Bot } from 'lucide-react';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { type MenuProps } from '@/components/Menu';
import { DiscoverTab } from '@/types/discover';

const ICON_SIZE = 16;

export const useNav = () => {
  const location = useLocation();
  const { t } = useTranslation('discover');
  const activeKey = useMemo(() => {
    const section = location.pathname.split('/community/')[1]?.split('/')[0];
    if (section === DiscoverTab.Plugins || section === DiscoverTab.Mcp) return DiscoverTab.Mcp;
    if (section === DiscoverTab.Skills) return DiscoverTab.Skills;
    return DiscoverTab.Assistants;
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
        icon: <MCP className={'anticon'} size={ICON_SIZE} />,
        key: DiscoverTab.Mcp,
        label: <div style={{ color: 'inherit', display: 'inline' }}>{t('tab.connector')}</div>,
      },
      // Models / Model Providers are hidden, not deleted: see
      // `@/spa/router/communityHiddenRoutes` for the restore path.
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
