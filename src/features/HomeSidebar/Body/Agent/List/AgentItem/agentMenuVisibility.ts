interface AgentDeleteMenuVisibility {
  canEdit: boolean;
  canManage: boolean;
}

export type AgentPublishErrorKey = 'agent.publishToWorkspaceErrorFixedPrivateDevice';

export const getAgentPublishErrorKey = (error: unknown): AgentPublishErrorKey | undefined => {
  if (typeof error !== 'object' || error === null) return;

  const data = (error as { data?: { errorData?: { code?: unknown } } }).data;
  if (data?.errorData?.code === 'FixedAgentRequiresPublicWorkspaceDevice') {
    return 'agent.publishToWorkspaceErrorFixedPrivateDevice';
  }
};

export const shouldShowAgentDeleteMenuItem = ({ canEdit, canManage }: AgentDeleteMenuVisibility) =>
  canEdit && canManage;
