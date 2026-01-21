'use client';

import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

export interface ClientTaskStats {
  isLoading: boolean;
  startTime?: number;
  steps: number;
  toolCalls: number;
}

interface UseClientTaskStatsOptions {
  enabled?: boolean;
  threadId?: string;
}

/**
 * Hook to fetch thread messages and compute task statistics for client mode tasks.
 * Used in TaskItem to display progress metrics (steps, tool calls, elapsed time).
 */
export const useClientTaskStats = ({
  threadId,
  enabled = true,
}: UseClientTaskStatsOptions): ClientTaskStats => {
  const [activeAgentId, activeTopicId, useFetchMessages] = useChatStore((s) => [
    s.activeAgentId,
    s.activeTopicId,
    s.useFetchMessages,
  ]);

  const threadContext = useMemo(
    () => ({
      agentId: activeAgentId,
      scope: 'thread' as const,
      threadId,
      topicId: activeTopicId,
    }),
    [activeAgentId, activeTopicId, threadId],
  );

  const threadMessageKey = useMemo(
    () => (threadId ? messageMapKey(threadContext) : null),
    [threadId, threadContext],
  );

  // Fetch thread messages (skip when disabled or no threadId)
  useFetchMessages(threadContext, !enabled || !threadId);

  // Get thread messages from store using selector
  const threadMessages = useChatStore((s) =>
    threadMessageKey
      ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s)
      : undefined,
  );

  // Compute stats from thread messages
  return useMemo(() => {
    if (!threadMessages || !enabled) {
      return { isLoading: true, steps: 0, toolCalls: 0 };
    }

    // Find the assistantGroup message which contains the children blocks
    const assistantGroupMessage = threadMessages.find((item) => item.role === 'assistantGroup');
    const blocks = assistantGroupMessage?.children ?? [];

    // Calculate stats
    const steps = blocks.length;
    const toolCalls = blocks.reduce((sum, block) => sum + (block.tools?.length || 0), 0);
    const startTime = assistantGroupMessage?.createdAt;

    return {
      isLoading: false,
      startTime,
      steps,
      toolCalls,
    };
  }, [threadMessages, enabled]);
};
