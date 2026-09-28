export interface NotifyScheduledTaskCompletedParams {
  /** Agent executing the task — lets inbox surfaces render its avatar. */
  agentId?: string;
  /** Final assistant reply text of the tick — may be used to build a preview. */
  lastAssistantContent?: string;
  operationId: string;
  taskId: string;
  /** Workspace-level task identifier (e.g. 'T-1'), used as the name fallback. */
  taskIdentifier: string;
  taskName?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

export interface NotifyScheduledTaskFailedParams {
  /** Agent executing the task — lets inbox surfaces render its avatar. */
  agentId?: string;
  /** Consecutive automation-tick failures including this one (schedule fuse). */
  consecutiveFailures?: number;
  /** Structured terminal error type (e.g. `InsufficientBudgetForModel`). Never
   *  the raw error text — that stays in briefs/logs. */
  errorCode?: string;
  operationId: string;
  /** True when this failure blew the fuse and auto-paused the task. */
  paused?: boolean;
  runTrigger: 'heartbeat' | 'schedule';
  taskId: string;
  taskIdentifier: string;
  taskName?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

export async function notifyScheduledTaskCompleted(
  _params: NotifyScheduledTaskCompletedParams,
): Promise<void> {}

export async function notifyScheduledTaskFailed(
  _params: NotifyScheduledTaskFailedParams,
): Promise<void> {}
