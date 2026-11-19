'use client';

import type { FavoriteItem as FavoriteItemType } from '@lobechat/types';
import { ActionIcon, type DropdownItem, DropdownMenu, Icon, toast } from '@lobehub/ui';
import { MoreHorizontalIcon, StarOffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useHomeStore } from '@/store/home';

import FavoriteItemIcon from './FavoriteItemIcon';

interface FavoriteItemProps {
  active?: boolean;
  item: FavoriteItemType;
}

const FavoriteItem = memo<FavoriteItemProps>(({ active, item }) => {
  const { t } = useTranslation('common');
  const removeFavorite = useHomeStore((s) => s.removeFavorite);

  const menuItems = (): DropdownItem[] => [
    {
      icon: <Icon icon={StarOffIcon} />,
      key: 'removeFavorite',
      label: t('favorite.remove'),
      onClick: () => {
        removeFavorite(item.type, item.targetId).catch((error) => {
          console.error('[favorite] remove failed', error);
          toast.error(t('favorite.updateError'));
        });
      },
    },
  ];

  return (
    <WorkspaceLink to={item.path}>
      <NavItem
        active={active}
        contextMenuItems={menuItems}
        icon={<FavoriteItemIcon item={item} />}
        title={item.title}
        actions={() => (
          <DropdownMenu items={menuItems()}>
            <ActionIcon
              aria-label={t('more')}
              icon={MoreHorizontalIcon}
              size={'small'}
              style={{ flex: 'none' }}
            />
          </DropdownMenu>
        )}
      />
    </WorkspaceLink>
  );
});

FavoriteItem.displayName = 'FavoriteItem';

export default FavoriteItem;
