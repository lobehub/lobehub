'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';

interface SharedMessageListProps {
  agentId: string | null;
  shareId: string;
  topicId: string;
}

const SharedMessageList = memo<SharedMessageListProps>(({ agentId, shareId, topicId }) => {
  const context = useMemo(
    () => ({
      agentId: agentId ?? '',
      topicId,
      topicShareId: shareId,
    }),
    [agentId, shareId, topicId],
  );

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
    [],
  );

  return (
    <ConversationProvider context={context}>
      <Flexbox
        flex={1}
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
        }}
        width={'100%'}
      >
        <ChatList itemContent={itemContent} />
      </Flexbox>
    </ConversationProvider>
  );
});

export default SharedMessageList;
