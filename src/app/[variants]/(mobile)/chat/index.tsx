'use client';

import { memo } from 'react';

import ConversationArea from '@/app/[variants]/(main)/chat/features/Conversation/ConversationArea';
import PortalPanel from '@/app/[variants]/(main)/chat/features/Portal/features/PortalPanel';
import MainInterfaceTracker from '@/components/Analytics/MainInterfaceTracker';

import PageTitle from '../../(main)/chat/features/PageTitle';
import TelemetryNotification from '../../(main)/chat/features/TelemetryNotification';
import Topic from './features/Topic';

const MobileChatPage = memo(() => {
  return (
    <>
      <PageTitle />
      <ConversationArea />
      <Topic />
      <PortalPanel mobile />
      <MainInterfaceTracker />
      <TelemetryNotification mobile />
    </>
  );
});

export default MobileChatPage;
