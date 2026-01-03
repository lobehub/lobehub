'use client';

import { type ConversationContext } from '@lobechat/types';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';

/**
 * Hook to get group conversation context
 *
 * Returns context with scope='group' or 'group_agent' and supervisorAgentId as agentId.
 * Used for group chat pages where multiple agents participate.
 */
export function useGroupContext(): ConversationContext {
  const [topicId, threadId, groupId] = useChatStore((s) => [
    s.activeTopicId ?? null,
    s.activeThreadId ?? null,
    s.activeGroupId ?? null,
  ]);

  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);
  const supervisorAgentId = currentGroup?.supervisorAgentId;

  // Group context uses supervisorAgentId as agentId for message storage
  return {
    agentId: supervisorAgentId || '',
    groupId: groupId ?? undefined,
    scope: threadId ? 'group_agent' : 'group',
    threadId,
    topicId,
  };
}
