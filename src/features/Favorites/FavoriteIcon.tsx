'use client';

import type { FavoriteType } from '@lobechat/types';
import { Avatar, cssVar, Icon } from '@lobehub/ui';
import {
  BotIcon,
  FileTextIcon,
  HashIcon,
  LayoutDashboardIcon,
  LinkIcon,
  ListTodoIcon,
  type LucideIcon,
  PackageIcon,
  TargetIcon,
  UsersIcon,
} from 'lucide-react';
import { memo } from 'react';

const TYPE_ICONS: Record<FavoriteType, LucideIcon> = {
  agent: BotIcon,
  dashboard: LayoutDashboardIcon,
  goal: TargetIcon,
  group: UsersIcon,
  page: FileTextIcon,
  project: PackageIcon,
  route: LinkIcon,
  task: ListTodoIcon,
  topic: HashIcon,
};

interface FavoriteIconProps {
  /** Emoji or avatar URL snapshot; falls back to the type icon. */
  icon?: string | null;
  size?: number;
  title?: string;
  type: FavoriteType;
}

const FavoriteIcon = memo<FavoriteIconProps>(({ icon, size = 16, title, type }) => {
  if (icon) return <Avatar avatar={icon} shape={'square'} size={size + 2} title={title} />;

  return (
    <Icon icon={TYPE_ICONS[type]} size={size} style={{ color: cssVar.colorTextDescription }} />
  );
});

FavoriteIcon.displayName = 'FavoriteIcon';

export default FavoriteIcon;
