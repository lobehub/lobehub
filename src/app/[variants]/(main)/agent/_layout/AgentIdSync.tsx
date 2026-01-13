import { useUnmount, useUpdateEffect } from 'ahooks';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

const AgentIdSync = () => {
  const useStoreUpdater = createStoreUpdater(useAgentStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ aid?: string }>();

  useStoreUpdater('activeAgentId', params.aid);
  useChatStoreUpdater('activeAgentId', params.aid ?? '');

  // Clear activeTopicId when switching agents (params.aid changes after initial mount)
  // This ensures new conversations get saved to a new topic instead of the previous agent's topic
  useUpdateEffect(() => {
    useChatStore.setState({ activeThreadId: undefined, activeTopicId: undefined });
  }, [params.aid]);

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined });
    useChatStore.setState({ activeAgentId: undefined, activeTopicId: undefined });
  });

  return null;
};

export default AgentIdSync;
