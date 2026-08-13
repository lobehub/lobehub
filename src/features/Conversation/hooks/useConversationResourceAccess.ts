'use client';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { chatGroupProjectionSelectors, useChatGroupProjection } from '@/projection';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';
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
  const agentVisibility = useAgentValue(agentId ?? undefined, agentProjectionSelectors.visibility);
  const group = useChatGroupProjection((scope) =>
    groupId ? chatGroupProjectionSelectors.getGroupById(groupId)(scope) : undefined,
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
