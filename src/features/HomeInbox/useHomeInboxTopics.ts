import { useCallback } from 'react';

import {
  getEntityStoreState,
  useHomeInboxTopicIds,
  useHomeInboxTopicsRequest,
} from '@/store/entity';
import { type ChatTopicStatus } from '@/types/topic';

export interface HomeInboxTopics {
  error: unknown;
  isInit: boolean;
  /** Optimistically move a replied topic into the running index view. */
  promoteToRunning: (topicId: string) => void;
  reload: () => void;
  runningIds: string[];
  unreadIds: string[];
}

/**
 * Request state plus index-derived IDs. The topic records themselves are read
 * only by the rows that render them.
 *
 * `userIdFilter === null` selects all workspace owners; other values preserve
 * the existing strict `topic.userId === userId` mine filter.
 */
export const useHomeInboxTopics = (
  isLogin: boolean | undefined,
  userIdFilter: string | null | undefined = null,
  requireAgentId = false,
): HomeInboxTopics => {
  const request = useHomeInboxTopicsRequest(isLogin);
  const runningIds = useHomeInboxTopicIds('running', userIdFilter, requireAgentId);
  const unreadIds = useHomeInboxTopicIds('unread', userIdFilter);

  const promoteToRunning = useCallback(
    (topicId: string) => {
      getEntityStoreState().updateTopicEntityStatus(
        request.scope,
        topicId,
        'running' as ChatTopicStatus,
      );
      setTimeout(() => void request.mutate(), 1000);
    },
    [request.mutate, request.scope],
  );
  const reload = useCallback(() => void request.mutate(), [request.mutate]);

  return {
    error: request.error && !request.isInitialized ? request.error : undefined,
    isInit: request.isInitialized,
    promoteToRunning,
    reload,
    runningIds,
    unreadIds,
  };
};
