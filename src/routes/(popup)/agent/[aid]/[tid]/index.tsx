'use client';

import { memo, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';

import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import Conversation from '@/routes/(main)/agent/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

const PopupAgentTopicPage = memo(() => {
  const { aid, tid } = useParams<{ aid: string; tid: string }>();

  useInitAgentConfig(aid);

  useLayoutEffect(() => {
    if (!aid) return;
    useAgentStore.setState({ activeAgentId: aid }, false, 'PopupAgentTopicPage/sync');
    useChatStore.setState(
      {
        activeAgentId: aid,
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: tid,
      },
      false,
      'PopupAgentTopicPage/sync',
    );
  }, [aid, tid]);

  // Populate topicDataMap so the title-bar can resolve the topic title,
  // and so chat operations that read topic metadata behave correctly.
  useFetchTopics();

  if (!aid || !tid) return null;

  return <Conversation />;
});

PopupAgentTopicPage.displayName = 'PopupAgentTopicPage';

export default PopupAgentTopicPage;
