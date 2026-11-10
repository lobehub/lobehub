'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type LucideIcon } from 'lucide-react';
import { memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { isModifierClick } from '@/utils/navigation';

import { RAIL_ICON_SIZE, styles } from './style';

interface RailItemProps {
  active?: boolean;
  badge?: number;
  icon: LucideIcon;
  title: string;
  url: string;
}

const RailItem = memo<RailItemProps>(({ active, badge, icon, title, url }) => {
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Tooltip placement={'right'} title={title}>
      <WorkspaceLink
        aria-current={active ? 'page' : undefined}
        aria-label={title}
        {...stylex.props(styles.item, active && styles.itemActive)}
        to={url}
        onClick={(e) => {
          if (isModifierClick(e)) return;
          e.preventDefault();
          navigate(url);
        }}
      >
        <Icon icon={icon} size={RAIL_ICON_SIZE} />
        {!!badge && badge > 0 && (
          <span {...stylex.props(styles.badge)}>{badge > 99 ? '99+' : badge}</span>
        )}
      </WorkspaceLink>
    </Tooltip>
  );
});

RailItem.displayName = 'RailItem';

export default RailItem;
