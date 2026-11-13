'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import TopicInPopupGuard from '@/features/TopicPopupGuard';
import { useTopicInPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useChatStore } from '@/store/chat';

import Conversation from './features/Conversation';
import ChatHydration from './features/Conversation/ChatHydration';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = memo(() => {
  const { topicId: urlTopicId } = useParams<{ topicId?: string }>();
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const popup = useTopicInPopup({
    agentId: activeAgentId,
    topicId: urlTopicId ?? '',
  });

  // When the same topic is already hosted in a popup window, avoid
  // rendering a second (out-of-sync) instance here — guide the user back
  // to the popup instead.
  const pageContent =
    urlTopicId && popup ? (
      <TopicInPopupGuard popup={popup} />
    ) : (
      <>
        {/* Clips vertically only: the message scroller extends sideways under the
            floating Overview card (see ConversationWorkspace). */}
        <Flexbox
          horizontal
          height={'100%'}
          style={{ overflowX: 'visible', overflowY: 'clip', position: 'relative' }}
          width={'100%'}
        >
          <Conversation />
        </Flexbox>
        <TelemetryNotification mobile={false} />
      </>
    );

  return (
    <>
      <ChatHydration />
      {pageContent}
    </>
  );
});

export default ChatPage;
