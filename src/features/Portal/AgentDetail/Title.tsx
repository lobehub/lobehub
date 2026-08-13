'use client';

import { agentDisplayName } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentMeta } from '@/store/agent/projection';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const meta = useAgentMeta(agentId || '');

  return (
    <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
      <Avatar avatar={meta.avatar} background={meta.backgroundColor} shape="square" size={24} />
      <Text ellipsis weight={500}>
        {agentDisplayName(meta, agentId ?? '')}
      </Text>
    </Flexbox>
  );
});

export default Title;
