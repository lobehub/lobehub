export interface NotifyTaskAssignedParams {
  /** The member who performed the assignment — never notified. */
  actorUserId: string;
  /** The member the task was assigned to — the notification recipient. */
  assigneeUserId: string;
  taskId: string;
  /** Workspace-level task identifier (e.g. 'TASK-1'), used as the name fallback. */
  taskIdentifier: string;
  taskName?: string | null;
  workspaceId?: string;
}

export async function notifyTaskAssigned(_params: NotifyTaskAssignedParams): Promise<void> {}
