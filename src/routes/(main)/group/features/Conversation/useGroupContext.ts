'use client';

import { type ConversationContext } from '@lobechat/types';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
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
  const workspaceSlug = useActiveWorkspaceSlug();
  const [topicId, threadId] = useChatStore((s) => [
    s.activeTopicId ?? null,
    s.activeThreadId ?? null,
  ]);

  const currentGroup = useAgentGroupStore((s) =>
    s.activeGroupId ? agentGroupSelectors.getGroupById(s.activeGroupId)(s) : undefined,
  );
  const supervisorAgentId = currentGroup?.supervisorAgentId;
  // Derive groupId from the resolved group — the same source as supervisorAgentId —
  // instead of the route-synced chatStore.activeGroupId. When that global is
  // transiently empty, sourcing groupId from it writes group messages/topics with an
  // agentId but groupId=null, orphaning them out of the group's history view.
  const groupId = currentGroup?.id ?? null;

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
    ...(workspaceSlug ? { workspaceSlug } : {}),
  };
}
