import { usePrevious, useUnmount } from 'ahooks';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { createStoreUpdater } from 'zustand-utils';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

const GroupIdSync = () => {
  const useAgentGroupStoreUpdater = createStoreUpdater(useAgentGroupStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ gid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();
  const prevGroupId = usePrevious(params.gid);
  const router = useQueryRoute();

  // Sync groupId to agentGroupStore and chatStore
  useAgentGroupStoreUpdater('activeGroupId', params.gid);
  useChatStoreUpdater('activeGroupId', params.gid);

  // Inject router to agentGroupStore for navigation
  useAgentGroupStoreUpdater('router', router);

  // Reset activeTopicId when switching to a different group
  // This prevents messages from being saved to the wrong topic bucket
  useEffect(() => {
    // Only reset topic when switching between groups (not on initial mount).
    // Preserve the topic if the URL already carries one (e.g. tab navigation).
    // Note: `params.topicId` can lag behind the URL during the same render cycle,
    // so also check the search params and the current store value to avoid
    // clearing a freshly-selected topic (which causes ChatHydration to bounce
    // back to the group root). Mirrors the agent-side guard in
    // `useAgentIdStoreSync` (topicFromPath && topicFromQuery).
    const isSwitchingGroup = prevGroupId !== undefined && prevGroupId !== params.gid;
    const hasTopicInUrl = Boolean(params.topicId || searchParams.get('topic'));
    const hasTopicInStore = Boolean(useChatStore.getState().activeTopicId);
    if (isSwitchingGroup && !hasTopicInUrl && !hasTopicInStore) {
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }
  }, [params.gid, params.topicId, prevGroupId, searchParams]);

  // Clear activeGroupId when unmounting (leaving group page)
  useUnmount(() => {
    useAgentGroupStore.setState({ activeGroupId: undefined, router: undefined });
    useChatStore.setState({ activeGroupId: undefined, activeTopicId: undefined });
  });

  return null;
};

export default GroupIdSync;