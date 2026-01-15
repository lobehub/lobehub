'use client';

import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

import GroupAvatar from '@/features/GroupAvatar';

export interface AgentGroupAvatarProps {
  /**
   * Custom avatar for the group (emoji or url)
   */
  avatar?: string;
  /**
   * Background color for custom avatar
   */
  backgroundColor?: string;
  /**
   * Member avatars to display when no custom avatar
   */
  memberAvatars?: { avatar?: string; background?: string }[];
  /**
   * Avatar size
   */
  size?: number;
}

const AgentGroupAvatar = memo<AgentGroupAvatarProps>(
  ({ avatar, backgroundColor, memberAvatars = [], size = 28 }) => {
    // If group has custom avatar, show it; otherwise show member avatars composition
    if (avatar) {
      return <Avatar avatar={avatar} background={backgroundColor} shape="square" size={size} />;
    }

    return <GroupAvatar avatars={memberAvatars} size={size} />;
  },
);

export default AgentGroupAvatar;
