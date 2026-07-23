import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * Resolve whether the current caller manages an Agent rather than merely
 * editing or using it through Workspace Member Permissions.
 *
 * Authors and Workspace admins (`canManage`) configure the shared Agent row;
 * ordinary members use the Agent's member-selection policy even when General
 * access grants them edit capability.
 */
export const useAgentManagementAccess = (agentId?: string) => {
  const agent = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentById(agentId)(s) : undefined,
  );
  const isAgentLoading = !!agentId && !agent;
  const isPublicWorkspaceAgent = !!agent?.workspaceId && agent.visibility !== 'private';
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canManageResource, isAccessResolved, isLoading } = useResourceAccess(
    'agent',
    isPublicWorkspaceAgent ? agentId : undefined,
  );

  return {
    canManageAgent:
      !isAgentLoading &&
      (!isPublicWorkspaceAgent || (isAccessResolved && canEditContent && canManageResource)),
    isAccessLoading: isAgentLoading || (isPublicWorkspaceAgent && (isLoading || !isAccessResolved)),
  };
};
