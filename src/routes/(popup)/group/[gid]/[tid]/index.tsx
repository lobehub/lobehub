'use client';

import { memo, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';

import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import GroupConversation from '@/routes/(main)/group/features/Conversation';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

const PopupGroupTopicPage = memo(() => {
  const { gid, tid } = useParams<{ gid: string; tid: string }>();

  useInitGroupConfig();

  useLayoutEffect(() => {
    if (!gid) return;
    useAgentGroupStore.setState({ activeGroupId: gid }, false, 'PopupGroupTopicPage/sync');
    useChatStore.setState(
      {
        activeAgentId: undefined,
        activeGroupId: gid,
        activeThreadId: undefined,
        activeTopicId: tid,
      },
      false,
      'PopupGroupTopicPage/sync',
    );
  }, [gid, tid]);

  useFetchTopics();

  if (!gid || !tid) return null;

  return <GroupConversation />;
});

PopupGroupTopicPage.displayName = 'PopupGroupTopicPage';

export default PopupGroupTopicPage;
