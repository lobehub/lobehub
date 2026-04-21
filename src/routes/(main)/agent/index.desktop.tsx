'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TopicInPopupGuard from '@/features/TopicPopupGuard';
import { useTopicInPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useChatStore } from '@/store/chat';

import Conversation from './features/Conversation';
import ChatHydration from './features/Conversation/ChatHydration';
import AgentWorkingSidebar from './features/Conversation/WorkingSidebar';
import PageTitle from './features/PageTitle';
import Portal from './features/Portal';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const popup = useTopicInPopup({
    agentId: activeAgentId,
    topicId: activeTopicId ?? '',
  });

  // When the same topic is already hosted in a popup window, avoid
  // rendering a second (out-of-sync) instance here — guide the user back
  // to the popup instead.
  if (activeTopicId && popup) {
    return (
      <>
        <ChatHydration />
        <PageTitle />
        <TopicInPopupGuard popup={popup} />
      </>
    );
  }

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
        <AgentWorkingSidebar />
      </Flexbox>
      <TelemetryNotification mobile={false} />
    </>
  );
});

export default ChatPage;
