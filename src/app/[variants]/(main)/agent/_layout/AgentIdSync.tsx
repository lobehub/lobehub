import { useUnmount } from 'ahooks';
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

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined });
    useChatStore.setState({ activeAgentId: undefined, activeTopicId: undefined });
  });

  return null;
};

export default AgentIdSync;
