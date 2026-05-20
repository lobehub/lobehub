'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { ChatList } from '@/features/Conversation';
import MainChatInput from '@/routes/(main)/agent/features/Conversation/MainChatInput';

/**
 * Inner body of FloatingChatPanel.
 *
 * Assumes it is rendered inside a ConversationProvider. Pure layout — does not
 * read the chat store directly.
 */
const ChatBody = memo(() => {
  return (
    <Flexbox
      data-testid="floating-chat-panel-body"
      flex={1}
      height={'100%'}
      style={{ minHeight: 0, overflow: 'hidden' }}
      width={'100%'}
    >
      <Flexbox
        data-testid="floating-chat-panel-list"
        flex={1}
        width={'100%'}
        style={{
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <ChatList />
      </Flexbox>
      <MainChatInput />
    </Flexbox>
  );
});

ChatBody.displayName = 'FloatingChatPanelBody';

export default ChatBody;
