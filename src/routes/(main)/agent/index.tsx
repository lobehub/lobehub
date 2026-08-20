'use client';

import { Flexbox } from '@lobehub/ui';

import Conversation from '@/features/AgentConversation';
import ChatHydration from '@/features/AgentConversation/ChatHydration';

import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = () => {
  return (
    <>
      <ChatHydration />
      <Flexbox
        height={'100%'}
        style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Conversation />
      </Flexbox>
      <TelemetryNotification mobile={false} />
    </>
  );
};

export default ChatPage;
