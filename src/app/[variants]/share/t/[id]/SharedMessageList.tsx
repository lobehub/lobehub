'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';

import { ChatList, ConversationProvider, MessageItem } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

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

  // Sync messages to chatStore for artifact selectors to work
  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} key={id} />,
    [],
  );

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      onMessagesChange={(messages) => {
        replaceMessages(messages, { context });
      }}
    >
      <Flexbox flex={1}>
        <ChatList disableActionsBar itemContent={itemContent} />
      </Flexbox>
    </ConversationProvider>
  );
});

export default SharedMessageList;
