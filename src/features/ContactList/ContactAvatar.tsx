import type { SidebarAgentItem } from '@lobechat/types';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';

/** An agent's or group's avatar, shared by the contact row and the contact card. */
const ContactAvatar = memo<{ item: SidebarAgentItem; name: string; size: number }>(
  ({ item, name, size }) => {
    const customAvatar = typeof item.avatar === 'string' ? item.avatar : undefined;

    return item.type === 'group' ? (
      <AgentGroupAvatar
        avatar={customAvatar}
        backgroundColor={item.backgroundColor || undefined}
        memberAvatars={Array.isArray(item.avatar) ? item.avatar : []}
        size={size}
      />
    ) : (
      <AgentAvatar
        agentId={item.id}
        avatar={customAvatar}
        background={item.backgroundColor || undefined}
        name={name}
        size={size}
      />
    );
  },
);

ContactAvatar.displayName = 'ContactAvatar';

export default ContactAvatar;
