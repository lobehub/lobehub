'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import Avatar from '@/components/Avatar';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId || ''));
  const displayName = agentDisplayName(meta, agentId ?? '');

  return (
    <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
      <Avatar
        avatar={meta.avatar}
        background={meta.backgroundColor}
        name={displayName}
        shape="square"
        size={24}
      />
      <Text ellipsis weight={500}>
        {displayName}
      </Text>
    </Flexbox>
  );
});

export default Title;
