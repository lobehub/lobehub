'use client';

import { Block } from '@lobehub/ui';
import { memo } from 'react';

import GroupAvatar from '@/features/GroupAvatar';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const HeaderAvatar = memo<{ size?: number }>(() => {
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);
  const agents = currentGroup?.agents || [];

  const openChatSettings = useOpenChatSettings();

  return (
    <Block
      clickable
      flex={'none'}
      height={32}
      onClick={(e) => {
        e.stopPropagation();
        openChatSettings();
      }}
      padding={2}
      style={{
        overflow: 'hidden',
      }}
      variant={'borderless'}
      width={32}
    >
      <GroupAvatar
        avatars={agents.map((agent) => ({
          avatar: agent.avatar,
          background: agent.backgroundColor || undefined,
        }))}
        size={28}
      />
    </Block>
  );
});

export default HeaderAvatar;
