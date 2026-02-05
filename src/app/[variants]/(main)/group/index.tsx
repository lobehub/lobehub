'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MainInterfaceTracker from '@/components/Analytics/MainInterfaceTracker';

import Conversation from './features/Conversation';
import PageTitle from './features/PageTitle';
import Portal from './features/Portal';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  return (
    <>
      <PageTitle />
      <Flexbox
        horizontal
        height={'100%'}
        style={{ overflow: 'hidden', position: 'relative' }}
        width={'100%'}
      >
        <Conversation />
        <Portal />
      </Flexbox>
      <MainInterfaceTracker />
      <TelemetryNotification mobile={false} />
    </>
  );
});

export default ChatPage;
