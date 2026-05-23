'use client';

import { memo } from 'react';

import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';
import ConversationArea from '@/routes/(main)/agent/features/Conversation/ConversationArea';
import PortalPanel from '@/routes/(main)/agent/features/Portal/features/PortalPanel';
import TelemetryNotification from '@/routes/(main)/agent/features/TelemetryNotification';

import Topic from './features/Topic';

const MobileChatPage = memo(() => {
  return (
    <>
      <ChatHydration />
      <ConversationArea />
      <Topic />
      <PortalPanel mobile />
      <TelemetryNotification mobile />
    </>
  );
});

export default MobileChatPage;
