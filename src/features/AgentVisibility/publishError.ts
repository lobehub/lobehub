export type AgentPublishErrorKey = 'agent.publishToWorkspaceErrorFixedPrivateDevice';

/** The specific copy for a refused publish, when the server named a known reason. */
export const getAgentPublishErrorKey = (error: unknown): AgentPublishErrorKey | undefined => {
  if (typeof error !== 'object' || error === null) return;

  const data = (error as { data?: { errorData?: { code?: unknown } } }).data;
  if (data?.errorData?.code === 'FixedAgentRequiresPublicWorkspaceDevice') {
    return 'agent.publishToWorkspaceErrorFixedPrivateDevice';
  }
};
