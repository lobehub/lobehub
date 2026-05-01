import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { useChatStore } from '@/store/chat/store';

export interface AgentMockReplayTarget {
  agentId?: string;
  threadId?: string | null;
  topicId?: string | null;
}

export const useAgentMockReplayTarget = () => {
  const params = useParams<{ aid?: string; topicId?: string }>();
  const [searchParams] = useSearchParams();

  return useCallback((): AgentMockReplayTarget => {
    const store = useChatStore.getState();
    const routeThreadId = searchParams.get('thread');
    const target = {
      agentId: store.activeAgentId ?? params.aid,
      threadId: routeThreadId ?? store.activeThreadId ?? null,
      topicId: params.topicId ?? store.activeTopicId ?? null,
    };
    return target;
  }, [params.aid, params.topicId, searchParams]);
};
