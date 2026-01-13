import { useUnmount } from 'ahooks';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

const GroupIdSync = () => {
  const useAgentGroupStoreUpdater = createStoreUpdater(useAgentGroupStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ gid?: string }>();
  const router = useQueryRoute();

  // Sync groupId to agentGroupStore and chatStore
  useAgentGroupStoreUpdater('activeGroupId', params.gid);
  useChatStoreUpdater('activeGroupId', params.gid);

  // Inject router to agentGroupStore for navigation
  useAgentGroupStoreUpdater('router', router);

  // Clear activeGroupId when unmounting (leaving group page)
  useUnmount(() => {
    useAgentGroupStore.setState({ activeGroupId: undefined, router: undefined });
    useChatStore.setState({ activeGroupId: undefined, activeTopicId: undefined });
  });

  return null;
};

export default GroupIdSync;
