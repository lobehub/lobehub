import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { ConversationProvider, MessageItem, useConversationStore } from '@/features/Conversation';

interface ChatListContentProps {
  ids: string[];
}

const ChatListContent = memo<ChatListContentProps>(({ ids }) => {
  const displayMessageIds = useConversationStore((s) => s.displayMessages.map((m) => m.id));
  const renderedIds = ids.length > 0 ? ids : displayMessageIds;

  return (
    <Flexbox
      height={'100%'}
      style={{ padding: 24, pointerEvents: 'none', position: 'relative' }}
      width={'100%'}
    >
      {renderedIds.map((id, index) => (
        <MessageItem id={id} index={index} key={id} />
      ))}
    </Flexbox>
  );
});

ChatListContent.displayName = 'ShareImageChatListContent';

interface ChatListProps {
  context: ConversationContext;
  ids: string[];
  messages: UIChatMessage[];
}

const ChatList = memo<ChatListProps>(({ context, ids, messages }) => {
  const hasInitMessages = messages.length > 0;

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={hasInitMessages}
      messages={messages}
      skipFetch={true}
    >
      <ChatListContent ids={ids} />
    </ConversationProvider>
  );
});

export default ChatList;
