'use client';

import { type ConversationContext } from '@lobechat/types';

import { useChatStore } from '@/store/chat';

/**
 * Hook to get agent conversation context
 *
 * Only for agent chat page (main/thread scope).
 * Returns context for regular agent conversations.
 */
export function useAgentContext(): ConversationContext {
  const [agentId, topicId, threadId] = useChatStore((s) => [
    s.activeAgentId,
    s.activeTopicId ?? null,
    s.activeThreadId ?? null,
  ]);

  return {
    agentId,
    scope: threadId ? 'thread' : 'main',
    threadId,
    topicId,
  };
}
