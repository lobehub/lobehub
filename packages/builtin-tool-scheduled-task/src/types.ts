export const ScheduledTaskIdentifier = 'lobe-scheduled-task';

export const ScheduledTaskApiName = {
  deleteScheduledTask: 'deleteScheduledTask',
  getScheduledTask: 'getScheduledTask',
  listScheduledTasks: 'listScheduledTasks',
  setScheduledTask: 'setScheduledTask',
};

export interface SetScheduledTaskParams {
  /**
   * Optional target agent ID.
   * - Required for create path when no conversation agent context is available.
   */
  agentId?: string;
  /**
   * Task content.
   * Required on create path.
   */
  content?: string;
  /**
   * Cron pattern.
   * Required on create path.
   */
  cronPattern?: string;
  /**
   * Optional task description.
   */
  description?: string;
  /**
   * Whether to enable task.
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional existing job ID.
   * - If provided: update the target task.
   * - If omitted: create a new task.
   */
  jobId?: string;
  /**
   * Maximum executions for this task.
   * Set null (or omit) for unlimited executions.
   */
  maxExecutions?: number | null;
  /**
   * Task name.
   * Required on create path.
   */
  name?: string;
  /**
   * Optional timezone override.
   * @default UTC
   */
  timezone?: string;
}

export interface SetScheduledTaskState {
  action: 'created' | 'updated';
  agentId: string;
  cronPattern: string;
  enabled: boolean;
  jobId: string;
  maxExecutions?: number | null;
  timezone: string;
  updatedFields?: string[];
}

export interface GetScheduledTaskParams {
  jobId: string;
}

export interface ScheduledTaskDetail {
  agentId: string;
  content: string;
  cronPattern: string;
  description?: string | null;
  enabled: boolean;
  jobId: string;
  lastExecutedAt?: string | null;
  maxExecutions?: number | null;
  name?: string | null;
  remainingExecutions?: number | null;
  timezone: string;
  totalExecutions?: number | null;
}

export interface GetScheduledTaskState extends ScheduledTaskDetail {}

export interface ListScheduledTasksParams {
  /**
   * Optional target agent ID. If omitted, current conversation agent is preferred.
   */
  agentId?: string;
  /**
   * Optional enabled status filter.
   */
  enabled?: boolean;
  /**
   * Maximum number of results.
   * @default 20
   */
  limit?: number;
  /**
   * Pagination offset.
   * @default 0
   */
  offset?: number;
}

export interface ListedScheduledTask {
  agentId: string;
  cronPattern: string;
  description?: string | null;
  enabled: boolean;
  jobId: string;
  lastExecutedAt?: string | null;
  maxExecutions?: number | null;
  name?: string | null;
  remainingExecutions?: number | null;
  timezone: string;
  totalExecutions?: number | null;
}

export interface ListScheduledTasksState {
  items: ListedScheduledTask[];
  limit: number;
  offset: number;
  total: number;
}

export interface DeleteScheduledTaskParams {
  jobId: string;
}

export interface DeleteScheduledTaskState {
  deleted: boolean;
  jobId: string;
}
