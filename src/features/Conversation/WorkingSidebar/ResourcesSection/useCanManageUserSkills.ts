import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';

export const useCanManageUserSkills = (agentId: string) => {
  const { allowed } = usePermission('edit_own_content');
  const visibility = useAgentStore((s) => s.agentMap[agentId]?.visibility);
  const { canEditResource, isAccessResolved } = useResourceAccess(
    'agent',
    visibility === 'private' ? undefined : agentId || undefined,
  );
  return Boolean(agentId && allowed && isAccessResolved && canEditResource);
};
