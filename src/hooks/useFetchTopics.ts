import type { TopicQuerySortBy } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { topicKeys } from '@/libs/swr/keys';
import { useChatTopicsIndex, useChatTopicsProjectionRequest } from '@/projection';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
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
  const [activeAgentId, activeGroupId, creatingTopicIds, prefetchUnreadTopicMessages] =
    useChatStore((s) => [
      s.activeAgentId,
      s.activeGroupId,
      s.creatingTopicIds,
      s.prefetchUnreadTopicMessages,
    ]);

  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);

  // If in group session, use groupId; otherwise use agentId
  const containerKey =
    activeGroupId || activeAgentId
      ? topicMapKey({ agentId: activeAgentId, groupId: activeGroupId })
      : undefined;
  const projectionIndex = useChatTopicsIndex('sidebar', containerKey);
  const excludeStatuses = options?.excludeStatuses?.length ? options.excludeStatuses : undefined;
  const excludeTriggers = options?.excludeTriggers?.length ? options.excludeTriggers : undefined;
  const inbox = activeGroupId ? false : isInbox;
  const request = useChatTopicsProjectionRequest(
    containerKey
      ? topicKeys.list(containerKey, {
          excludeStatuses,
          excludeTriggers,
          isInbox: inbox,
          pageSize: topicPageSize,
          sortBy: options?.sortBy,
        })
      : null,
    {
      containerKey: containerKey ?? '',
      context: { agentId: activeAgentId ?? null, groupId: activeGroupId ?? null },
      page: 0,
      pageSize: topicPageSize,
      preserveIds: creatingTopicIds,
      request: {
        agentId: activeAgentId,
        current: 0,
        excludeStatuses,
        excludeTriggers,
        groupId: activeGroupId,
        isInbox: inbox,
        pageSize: topicPageSize,
        sortBy: options?.sortBy,
      },
      signature: {
        excludeStatuses,
        excludeTriggers,
        isInbox: inbox,
        sortBy: options?.sortBy,
      },
      surface: 'sidebar',
    },
    Boolean(containerKey),
  );
  const previousContainerRef = useRef(containerKey);
  const previousItemsRef = useRef(request.data?.items);

  useEffect(() => {
    if (previousContainerRef.current !== containerKey) {
      previousContainerRef.current = containerKey;
      previousItemsRef.current = undefined;
    }
    if (!request.data) return;
    prefetchUnreadTopicMessages(request.data.items, previousItemsRef.current, {
      agentId: activeAgentId,
      groupId: activeGroupId,
    });
    previousItemsRef.current = request.data.items;
  }, [activeAgentId, activeGroupId, containerKey, prefetchUnreadTopicMessages, request.data]);

  return {
    ...request,
    isExpandingPageSize:
      request.isValidating &&
      Boolean(projectionIndex?.refs.length) &&
      topicPageSize > (projectionIndex?.persistRefLimit ?? topicPageSize),
    // isRevalidating: has cached data, updating in background
    isRevalidating: request.isValidating && !!projectionIndex,
  };
};
