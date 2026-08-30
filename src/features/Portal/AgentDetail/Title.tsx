'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import Avatar from '@/components/Avatar';
import { useAgentMeta } from '@/store/agent/projection';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const agentId = useChatStore(chatPortalSelectors.agentDetailId);
  const meta = useAgentMeta(agentId || '');
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
