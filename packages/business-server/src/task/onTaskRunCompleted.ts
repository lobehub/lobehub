export interface OnTaskRunCompletedParams {
  /** Agent that executed the run. */
  agentId?: string;
  /** Final assistant reply of the run. */
  lastAssistantContent?: string;
  operationId: string;
  taskId: string;
  /** Workspace-level task identifier (e.g. 'T-1'). */
  taskIdentifier: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Follow-up for a task run that finished normally, called after the
 * lifecycle's post-run status transition. A run whose delivery Verify still
 * decides leaves the task `running`. The default does nothing.
 */
export async function onTaskRunCompleted(_params: OnTaskRunCompletedParams): Promise<void> {}
