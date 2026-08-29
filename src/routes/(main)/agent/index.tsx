'use client';

import { Flexbox } from '@lobehub/ui';

import Conversation from '@/routes/(main)/agent/features/Conversation';
import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';

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
