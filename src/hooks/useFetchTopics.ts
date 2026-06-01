import type { TopicQuerySortBy } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

/**
 * Fetch topics for the current session (agent or group)
 */
export const useFetchTopics = (options?: {
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  sortBy?: TopicQuerySortBy;
}) => {
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const [activeAgentId, activeGroupId, useFetchTopicsHook] = useChatStore((s) => [
    s.activeAgentId,
    s.activeGroupId,
    s.useFetchTopics,
  ]);

  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);

  // If in group session, use groupId; otherwise use agentId
  const { isValidating, data } = useFetchTopicsHook(true, {
    agentId: activeAgentId,
    ...(options?.excludeStatuses && options.excludeStatuses.length > 0
      ? { excludeStatuses: options.excludeStatuses }
      : {}),
    ...(options?.excludeTriggers && options.excludeTriggers.length > 0
      ? { excludeTriggers: options.excludeTriggers }
      : {}),
    groupId: activeGroupId,
    isInbox: activeGroupId ? false : isInbox,
    pageSize: topicPageSize,
    ...(options?.sortBy ? { sortBy: options.sortBy } : {}),
  });

  return {
    // isRevalidating: has cached data, updating in background
    isRevalidating: isValidating && !!data,
  };
};
