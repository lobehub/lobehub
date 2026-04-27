'use client';

import { type ConversationContext } from '@lobechat/types';

import { useChatStore } from '@/store/chat';
import { useDocumentStore } from '@/store/document';

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
  const activeTopicDocumentId = useDocumentStore((s) => {
    if (!topicId || threadId) return undefined;

    const lastTopicDocumentId = s.lastActiveTopicDocumentIdByTopicId[topicId];
    const documentIds = [s.activeDocumentId, lastTopicDocumentId].filter(Boolean) as string[];

    for (const documentId of documentIds) {
      const document = s.documents[documentId];
      if (!document) {
        if (documentId === lastTopicDocumentId) return documentId;
        continue;
      }
      if (document.sourceType === 'notebook' && document.topicId === topicId) return documentId;
    }
  });

  return {
    agentId,
    documentId: activeTopicDocumentId,
    scope: threadId ? 'thread' : 'main',
    threadId,
    topicId,
  };
}
