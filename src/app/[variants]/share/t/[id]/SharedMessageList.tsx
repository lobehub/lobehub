'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';

interface SharedMessageListProps {
  agentId: string | null;
  groupId: string | null;
  shareId: string;
  topicId: string;
}

const SharedMessageList = memo<SharedMessageListProps>(({ agentId, groupId, shareId, topicId }) => {
  const context = useMemo(
    () => ({
      agentId: agentId ?? '',
      groupId: groupId ?? undefined,
      topicId,
      topicShareId: shareId,
    }),
    [agentId, groupId, shareId, topicId],
  );

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
    [],
  );

  return (
    <ConversationProvider context={context}>
      <Flexbox flex={1}>
        <ChatList disableActionsBar itemContent={itemContent} />
      </Flexbox>
    </ConversationProvider>
  );
});

export default SharedMessageList;
