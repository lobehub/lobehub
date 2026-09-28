import { useMemo } from 'react';

import type { StartTopicConversation } from '@/features/LocalFile';

import { useConversationStore } from '../store';

/**
 * The conversation a folder reference can start a fresh topic from, or
 * `undefined` when it cannot. Only a single-agent `main` conversation
 * qualifies: starting a topic writes that agent's default directory and then
 * clears the global active topic, which group, page, task, thread or portal
 * conversations (own scope / message bucket) would not follow. Share views
 * are read-only.
 */
export const useStartTopicConversation = (): StartTopicConversation | undefined => {
  const agentId = useConversationStore((s) => {
    const { context } = s;
    const isMain = (context.scope ?? 'main') === 'main';
    if (!isMain || context.groupId || context.topicShareId || context.agentShareId) return;
    return context.agentId || undefined;
  });
  const topicId = useConversationStore((s) => s.context.topicId ?? null);

  return useMemo(() => (agentId ? { agentId, topicId } : undefined), [agentId, topicId]);
};
