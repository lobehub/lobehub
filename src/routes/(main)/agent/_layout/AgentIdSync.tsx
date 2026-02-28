import { useMount, usePrevious, useUnmount } from 'ahooks';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

const AgentIdSync = () => {
  const useStoreUpdater = createStoreUpdater(useAgentStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ aid?: string }>();
  const prevAgentId = usePrevious(params.aid);

  useStoreUpdater('activeAgentId', params.aid);
  useChatStoreUpdater('activeAgentId', params.aid ?? '');

  // Reset activeTopicId when switching to a different agent
  // This prevents messages from being saved to the wrong topic bucket
  useEffect(() => {
    // Only reset topic when switching between agents (not on initial mount)
    if (prevAgentId !== undefined && prevAgentId !== params.aid) {
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }
    // Clear unread completion indicator for the agent being viewed
    if (params.aid) {
      useChatStore.getState().clearUnreadCompletedAgent(params.aid);
    }
  }, [params.aid, prevAgentId]);

  useMount(() => {
    useChatStore.setState({ activeAgentId: params.aid }, false, 'AgentIdSync/mountAgentId');
  });

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined }, false, 'AgentIdSync/unmountAgentId');
    useChatStore.setState(
      { activeAgentId: undefined, activeTopicId: undefined },
      false,
      'AgentIdSync/unmountAgentId',
    );
  });

  return null;
};

export default AgentIdSync;
