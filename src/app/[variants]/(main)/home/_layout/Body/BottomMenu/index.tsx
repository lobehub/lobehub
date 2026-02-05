import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { getRouteById } from '@/config/routes';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { SidebarTabKey } from '@/store/global/initialState';

interface Item {
  icon: any;
  key: SidebarTabKey;
  title: string;
  url: string;
}

const BottomMenu = memo(() => {
  const tab = useActiveTabKey();

  const navigate = useNavigate();
  const { t } = useTranslation('common');

  const items = useMemo(
    () =>
      [
        {
          icon: getRouteById('settings')!.icon,
          key: SidebarTabKey.Setting,
          title: t('tab.setting'),
          url: '/settings',
        },
        {
          icon: getRouteById('resource')!.icon,
          key: SidebarTabKey.Resource,
          title: t('tab.resource'),
          url: '/resource',
        },
        {
          icon: getRouteById('memory')!.icon,
          key: SidebarTabKey.Memory,
          title: t('tab.memory'),
          url: '/memory',
        },
      ].filter(Boolean) as Item[],
    [t],
  );

  return (
    <Flexbox
      gap={1}
      paddingBlock={4}
      style={{
        overflow: 'hidden',
      }}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.url}
          onClick={(e) => {
            e.preventDefault();
            navigate(item.url);
          }}
        >
          <NavItem active={tab === item.key} icon={item.icon} title={item.title} />
        </Link>
      ))}
    </Flexbox>
  );
});

export default BottomMenu;
