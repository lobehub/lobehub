'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { ChatInput, ChatList } from '@/features/Conversation';

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
      <ChatInput leftActions={['typo']} rightActions={['contextWindow']} />
    </Flexbox>
  );
});

ChatBody.displayName = 'FloatingChatPanelBody';

export default ChatBody;
