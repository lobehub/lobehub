'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Conversation from './features/Conversation';
import ChatHydration from './features/Conversation/ChatHydration';
import PageTitle from './features/PageTitle';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  return (
    <>
      <ChatHydration />
      <PageTitle />
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
});

export default ChatPage;
