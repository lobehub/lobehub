'use client';

import { Flexbox } from '@lobehub/ui';

import AgentHome from '@/features/AgentHome';
import { ChatList } from '@/features/Conversation';

const ChatBody = () => {
  return (
    <Flexbox
      data-testid="floating-chat-panel-body"
      flex={1}
      height={'100%'}
      style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
      width={'100%'}
    >
      <ChatList welcome={<AgentHome />} />
    </Flexbox>
  );
};

export default ChatBody;
