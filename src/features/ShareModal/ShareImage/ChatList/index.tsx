import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { ConversationProvider, MessageItem } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

const ChatList = memo(() => {
  const ids = useChatStore(chatSelectors.mainDisplayChatIDs);
  const messages = useChatStore(chatSelectors.activeBaseChats);
  const agentId = useChatStore((s) => s.activeId);
  const topicId = useChatStore((s) => s.activeTopicId);

  return (
    <ConversationProvider
      context={{ agentId, topicId }}
      hasInitMessages={true}
      messages={messages}
      skipFetch={true}
    >
      <Flexbox
        height={'100%'}
        style={{ padding: 24, pointerEvents: 'none', position: 'relative' }}
        width={'100%'}
      >
        {ids.map((id, index) => (
          <MessageItem id={id} index={index} key={id} />
        ))}
      </Flexbox>
    </ConversationProvider>
  );
});

export default ChatList;
