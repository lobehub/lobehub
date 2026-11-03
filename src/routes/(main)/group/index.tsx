'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Conversation from './features/Conversation';
import Portal from './features/Portal';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  return (
    <>
      <Flexbox
        horizontal
        height={'100%'}
        style={{ overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Conversation />
        <Portal />
      </Flexbox>
      <TelemetryNotification mobile={false} />
    </>
  );
});

export default ChatPage;
