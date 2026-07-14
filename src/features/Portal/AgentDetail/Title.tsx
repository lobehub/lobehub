'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId || ''));

  return (
    <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
      <Avatar avatar={meta.avatar} background={meta.backgroundColor} shape="square" size={24} />
      <Text ellipsis weight={500}>
        {meta.title || agentId}
      </Text>
    </Flexbox>
  );
});

export default Title;
