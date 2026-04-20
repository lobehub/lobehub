'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TopicInPopupGuard from '@/features/TopicPopupGuard';
import { useTopicInPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useChatStore } from '@/store/chat';

import Conversation from './features/Conversation';
import ChatHydration from './features/Conversation/ChatHydration';
import PageTitle from './features/PageTitle';
import Portal from './features/Portal';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const popup = useTopicInPopup({
    groupId: activeGroupId,
    topicId: activeTopicId ?? '',
  });

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
      </Flexbox>
      <TelemetryNotification mobile={false} />
    </>
  );
});

export default ChatPage;
