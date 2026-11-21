export const hasWorkspaceMemberDirectory = (activeWorkspaceId?: string | null) =>
  Boolean(activeWorkspaceId);

export const shouldShowMemberAssignee = (
  activeWorkspaceId?: string | null,
  assigneeUserId?: string | null,
) => hasWorkspaceMemberDirectory(activeWorkspaceId) || Boolean(assigneeUserId);

/**
 * The member a new workspace task is assigned to before the creator picks one:
 * the creator, when their role can be a task assignee. Personal mode has no
 * member row, so nothing is preselected there.
 */
export const getDefaultMemberAssignee = ({
  activeWorkspaceId,
  assignableMemberIds,
  selfUserId,
}: {
  activeWorkspaceId?: string | null;
  assignableMemberIds: ReadonlySet<string>;
  selfUserId?: string | null;
}): string | undefined => {
  if (!hasWorkspaceMemberDirectory(activeWorkspaceId) || !selfUserId) return undefined;
  return assignableMemberIds.has(selfUserId) ? selfUserId : undefined;
};

/**
 * Resolves the composer's member choice: `undefined` means the creator has not
 * chosen yet and follows the default, `null` means they explicitly cleared it.
 */
export const resolveMemberAssignee = (
  choice: string | null | undefined,
  defaultUserId: string | undefined,
): string | undefined => (choice === undefined ? defaultUserId : (choice ?? undefined));
