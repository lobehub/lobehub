'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import Avatar from './Avatar';

const HeaderInfo = memo(() => {
  const isInbox = useSessionStore(sessionSelectors.isInboxSession);
  const title = useAgentStore(agentSelectors.currentAgentTitle);

  const displayTitle = isInbox ? 'Lobe AI' : title;

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={8}
      style={{
        overflow: 'hidden',
      }}
    >
      <Avatar />
      <Text ellipsis weight={500}>
        {displayTitle}
      </Text>
    </Flexbox>
  );
});

export default HeaderInfo;
