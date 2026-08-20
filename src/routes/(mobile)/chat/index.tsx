'use client';

import { memo } from 'react';

import ChatHydration from '@/features/AgentConversation/ChatHydration';
import ConversationArea from '@/features/AgentConversation/ConversationArea';
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
