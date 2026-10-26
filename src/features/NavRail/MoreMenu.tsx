'use client';

import { DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { EllipsisIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useNavLayout } from '@/hooks/useNavLayout';

import { RAIL_ICON_SIZE, styles } from './style';

/**
 * Routes that have no rail tab of their own (generation, memory, dashboards)
 * stay one click away instead of disappearing with the old sidebar.
 */
const MoreMenu = memo<{ active?: boolean }>(({ active }) => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const { topNavItems, bottomMenuItems } = useNavLayout();

  const items = [...topNavItems, ...bottomMenuItems]
    .filter(
      (item) => !item.hidden && item.url && ['dashboard', 'image', 'memory'].includes(item.key),
    )
    .map((item) => ({
      icon: <Icon icon={item.icon} />,
      key: item.key,
      label: item.title,
      onClick: () => navigate(item.url!),
    }));

  if (items.length === 0) return null;

  return (
    <DropdownMenu items={items} placement={'rightTop'}>
      <Tooltip placement={'right'} title={t('tab.more')}>
        <div
          aria-label={t('tab.more')}
          {...stylex.props(styles.item, active && styles.itemActive)}
          role={'button'}
        >
          <Icon icon={EllipsisIcon} size={RAIL_ICON_SIZE} />
        </div>
      </Tooltip>
    </DropdownMenu>
  );
});

MoreMenu.displayName = 'MoreMenu';

export default MoreMenu;
