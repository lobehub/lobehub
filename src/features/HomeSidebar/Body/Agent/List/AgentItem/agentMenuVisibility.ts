interface AgentDeleteMenuVisibility {
  canEdit: boolean;
  canManage: boolean;
}

export const shouldShowAgentDeleteMenuItem = ({ canEdit, canManage }: AgentDeleteMenuVisibility) =>
  canEdit && canManage;
