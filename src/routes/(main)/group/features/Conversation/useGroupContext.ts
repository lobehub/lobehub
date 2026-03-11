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
  // When in group mode (not group_agent thread mode), the supervisor is responding
  // so we mark isSupervisor: true for proper UI rendering
  return {
    agentId: supervisorAgentId || '',
    groupId: groupId ?? undefined,
    isSupervisor: !threadId, // Supervisor responds in main group chat, not in agent threads
    scope: threadId ? 'group_agent' : 'group',
    threadId,
    topicId,
  };
}
