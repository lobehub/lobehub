'use client';

import { Avatar } from '@lobehub/ui';
import { type ReactNode, memo } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';
import NavItem from '@/features/NavPanel/components/NavItem';

interface GroupMemberItemProps {
  actions?: ReactNode;
  avatar?: string;
  background?: string;
  onClick?: () => void;
  title: string;
}

const GroupMemberItem = memo<GroupMemberItemProps>(({ title, avatar, background, actions }) => {
  return (
    <NavItem
      actions={actions}
      icon={
        <Avatar
          avatar={avatar || DEFAULT_AVATAR}
          background={background}
          emojiScaleWithBackground
          size={24}
          style={{ flex: 'none' }}
        />
      }
      title={title}
    />
  );
});

export default GroupMemberItem;
