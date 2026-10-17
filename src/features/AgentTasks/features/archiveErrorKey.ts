/**
 * The message for a rejected archive / unarchive. The server answers CONFLICT
 * when the task is still on an open Goal's plan; anything else is a generic
 * failure the user can retry after refreshing.
 */
export const getArchiveErrorKey = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === 'CONFLICT'
    ? ('taskList.contextMenu.archiveGoalBlocked' as const)
    : ('taskList.contextMenu.archiveFailed' as const);
