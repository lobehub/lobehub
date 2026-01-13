'use client';

import { memo } from 'react';

import ConversationArea from '@/app/[variants]/(main)/agent/features/Conversation/ConversationArea';
import PageTitle from '@/app/[variants]/(main)/agent/features/PageTitle';
import PortalPanel from '@/app/[variants]/(main)/agent/features/Portal/features/PortalPanel';
import TelemetryNotification from '@/app/[variants]/(main)/agent/features/TelemetryNotification';
import MainInterfaceTracker from '@/components/Analytics/MainInterfaceTracker';

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
