import { useUnmount, useUpdateEffect } from 'ahooks';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

const GroupIdSync = () => {
  const useAgentGroupStoreUpdater = createStoreUpdater(useAgentGroupStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ gid?: string }>();

  // Sync groupId to agentGroupStore and chatStore
  useAgentGroupStoreUpdater('activeGroupId', params.gid);
  useChatStoreUpdater('activeGroupId', params.gid);

  // Clear activeTopicId when switching groups (params.gid changes after initial mount)
  // This ensures new conversations get saved to a new topic instead of the previous group's topic
  useUpdateEffect(() => {
    useChatStore.setState({ activeThreadId: undefined, activeTopicId: undefined });
  }, [params.gid]);

  // Clear activeGroupId when unmounting (leaving group page)
  useUnmount(() => {
    useAgentGroupStore.setState({ activeGroupId: undefined });
    useChatStore.setState({ activeGroupId: undefined, activeTopicId: undefined });
  });

  return null;
};

export default GroupIdSync;
