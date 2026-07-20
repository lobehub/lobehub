'use client';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { useChatInputStore } from '../store';

/**
 * Per-resource General-access gating for the chat input: resolves which
 * workspace resource this input sends to (the bound agent, or the group when
 * the input reuses the supervisor's agentId as context — see useGroupContext)
 * and reports whether the member may use it. Home/new-conversation inputs (no
 * explicit agentId), the inbox agent, and private resources are never gated;
 * loading defaults permissive — the server remains the enforcement point.
 */
export const useChatInputResourceAccess = () => {
  const chatInputAgentId = useChatInputStore((s) => s.agentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentStore((s) =>
    chatInputAgentId ? s.agentMap[chatInputAgentId]?.visibility : undefined,
  );
  const activeGroup = useAgentGroupStore((s) =>
    s.activeGroupId ? agentGroupSelectors.getGroupById(s.activeGroupId)(s) : undefined,
  );
  const isGroupContext =
    !!chatInputAgentId && !!activeGroup && activeGroup.supervisorAgentId === chatInputAgentId;

  const gatedResourceId = isGroupContext
    ? activeGroup.visibility === 'private'
      ? undefined
      : activeGroup.id
    : chatInputAgentId && chatInputAgentId !== inboxAgentId && agentVisibility !== 'private'
      ? chatInputAgentId
      : undefined;

  const { allowed: canCreateContent } = usePermission('create_content');
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const {
    canEditResource,
    canUseResource: canUseResourceLevel,
    isAccessResolved,
    isLoading: isAccessLoading,
  } = useResourceAccess(isGroupContext ? 'agentGroup' : 'agent', gatedResourceId);

  return {
    canConfigureResource: isAccessResolved && canEditContent && canEditResource,
    canUseResource: canCreateContent && canUseResourceLevel,
    isAccessLoading,
    isGroupContext,
  };
};
