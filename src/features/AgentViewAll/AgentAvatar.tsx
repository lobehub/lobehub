'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { memo } from 'react';

import Avatar from '@/components/Avatar';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';

interface AgentAvatarProps {
  item: SidebarAgentItem;
  size: number;
}

/** Agent avatar that renders the stacked group variant for group chats. */
const AgentAvatar = memo<AgentAvatarProps>(({ item, size }) => {
  const { avatar, backgroundColor, type } = item;

  return type === 'group' ? (
    <AgentGroupAvatar
      avatar={typeof avatar === 'string' ? avatar : undefined}
      backgroundColor={backgroundColor || undefined}
      memberAvatars={Array.isArray(avatar) ? avatar : []}
      size={size}
    />
  ) : (
    <Avatar
      emojiScaleWithBackground
      avatar={typeof avatar === 'string' ? avatar : DEFAULT_AVATAR}
      background={backgroundColor || undefined}
      name={agentDisplayName(item)}
      shape={'square'}
      size={size}
    />
  );
});

AgentAvatar.displayName = 'AgentViewAllAgentAvatar';

export default AgentAvatar;
