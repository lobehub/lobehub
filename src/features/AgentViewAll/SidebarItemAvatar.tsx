'use client';

import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';

interface SidebarItemAvatarProps {
  item: SidebarAgentItem;
  /** Single-agent avatar shape; group avatars keep their stacked layout. */
  shape?: 'circle' | 'square';
  size: number;
}

/** Agent avatar that renders the stacked group variant for group chats. */
const SidebarItemAvatar = memo<SidebarItemAvatarProps>(({ item, shape, size }) => {
  const { avatar, backgroundColor, id, type } = item;

  return type === 'group' ? (
    <AgentGroupAvatar
      avatar={typeof avatar === 'string' ? avatar : undefined}
      backgroundColor={backgroundColor || undefined}
      memberAvatars={Array.isArray(avatar) ? avatar : []}
      size={size}
    />
  ) : (
    <AgentAvatar
      agentId={id}
      avatar={typeof avatar === 'string' ? avatar : undefined}
      background={backgroundColor || undefined}
      name={agentDisplayName(item)}
      shape={shape}
      size={size}
    />
  );
});

SidebarItemAvatar.displayName = 'SidebarItemAvatar';

export default SidebarItemAvatar;
