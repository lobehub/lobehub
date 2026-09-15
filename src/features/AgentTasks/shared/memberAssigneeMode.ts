export const hasWorkspaceMemberDirectory = (activeWorkspaceId?: string | null) =>
  Boolean(activeWorkspaceId);

export const shouldShowMemberAssignee = (
  activeWorkspaceId?: string | null,
  assigneeUserId?: string | null,
) => hasWorkspaceMemberDirectory(activeWorkspaceId) || Boolean(assigneeUserId);
