export interface NotifyTaskRunFailedParams {
  /** Agent executing the task — lets inbox surfaces render its avatar. */
  agentId?: string;
  /** Structured terminal error type (e.g. `InsufficientBudgetForModel`). Never
   *  the raw error text — that stays on the task and in logs. */
  errorCode?: string;
  /** Run that failed; absent for watchdog sweeps that never saw the run end. */
  operationId?: string;
  /**
   * Why the run is considered failed:
   * - `error`: the run ended with an error
   * - `heartbeat_timeout`: the watchdog found the task silent past its heartbeat timeout
   */
  reason: 'error' | 'heartbeat_timeout';
  taskId: string;
  /** Workspace-level task identifier (e.g. 'T-1'), used as the name fallback. */
  taskIdentifier: string;
  taskName?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Tells the owner a task run failed outside an automation tick (manual runs,
 * ad-hoc tasks, watchdog timeouts). Failures go to the notification center
 * instead of a "Needs you" error brief. Default impl is a no-op; callers fire
 * it and forget, so a notification failure never affects the task.
 */
export async function notifyTaskRunFailed(_params: NotifyTaskRunFailedParams): Promise<void> {}
