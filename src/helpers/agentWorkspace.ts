import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * The workspace a run belongs to: its agent's own, or none for a personal agent.
 *
 * Tool calls can land after the user switched workspaces, so the active one is
 * not the run's. The server resolves the same answer from the agent row
 * (`resolveContentWorkspaceId`); the active workspace is only the fallback for
 * an agent whose config is not in the store.
 */
export const resolveRunWorkspaceId = (agentId?: string): string | undefined => {
  const agent = agentId
    ? agentByIdSelectors.getAgentById(agentId)(useAgentStore.getState())
    : undefined;
  if (agent) return agent.workspaceId ?? undefined;
  return getActiveWorkspaceId() ?? undefined;
};
