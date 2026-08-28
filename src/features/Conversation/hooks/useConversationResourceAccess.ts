'use client';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../store';

interface ConversationResourceTarget {
  agentId?: string | null;
  groupId?: string | null;
}

const useConversationResourceAccessForTarget = ({
  agentId,
  groupId,
}: ConversationResourceTarget) => {
  const isGroupContext = !!groupId;

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentStore((s) =>
    agentId ? s.agentMap[agentId]?.visibility : undefined,
  );
  const group = useAgentGroupStore((s) =>
    groupId ? agentGroupSelectors.getGroupById(groupId)(s) : undefined,
  );

  const gatedResourceId = isGroupContext
    ? group?.visibility === 'private'
      ? undefined
      : groupId
    : agentId && agentId !== inboxAgentId && agentVisibility !== 'private'
      ? agentId
      : undefined;

  const { allowed: canCreateContent } = usePermission('create_content');
  const { canUseResource, isLoading } = useResourceAccess(
    isGroupContext ? 'agentGroup' : 'agent',
    gatedResourceId ?? undefined,
  );

  return {
    canUseResource: canCreateContent && canUseResource,
    isAccessLoading: isLoading,
    isGroupContext,
  };
};

/**
 * Per-resource General-access gating for the CURRENT conversation, resolved
 * from the ConversationStore context (the agent, or the group for group
 * conversations). The counterpart of `useChatInputResourceAccess` for
 * surfaces that live outside the ChatInput store tree — message actions,
 * intervention approvals, queue tray, URL/forward auto-send dispatchers.
 *
 * Workspace topics are shared across members, so a `view`-level member can
 * open a teammate's conversation — every mutating affordance must check
 * `canUseResource` before firing. Inbox and private resources are never
 * gated; loading defaults permissive (`isAccessLoading` lets auto-send
 * dispatchers wait for the settled value instead).
 */
export const useConversationResourceAccess = () => {
  const [agentId, groupId] = useConversationStore((s) => [s.context?.agentId, s.context?.groupId]);
  return useConversationResourceAccessForTarget({ agentId, groupId });
};

/**
 * Resource gating for surfaces that render beside, rather than inside, the
 * active ConversationProvider (for example the Portal pane). The global chat
 * store owns the same active agent/group coordinates used to build the main
 * conversation context, so these siblings can resolve access without touching
 * the provider-scoped ConversationStore.
 */
export const useActiveConversationResourceAccess = () => {
  const [agentId, groupId] = useChatStore((s) => [s.activeAgentId, s.activeGroupId]);
  return useConversationResourceAccessForTarget({ agentId, groupId });
};
