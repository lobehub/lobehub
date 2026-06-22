'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { ChatList } from '@/features/Conversation';

const ChatBody = memo(() => {
  return (
    <Flexbox
      data-testid="floating-chat-panel-body"
      flex={1}
      height={'100%'}
      style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
      width={'100%'}
    >
      <ChatList />
    </Flexbox>
  );
});

ChatBody.displayName = 'FloatingChatPanelBody';

export default ChatBody;
