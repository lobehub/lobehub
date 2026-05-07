import type { TaskStatus } from '@lobechat/types';

export const TaskApiName = {
  /** Create a new task, optionally as a subtask of another task */
  createTask: 'createTask',

  /** Create multiple tasks in a single call (batched) */
  createTasks: 'createTasks',

  /** Delete a task */
  deleteTask: 'deleteTask',

  /** Edit a task's name, description, instruction, priority, or dependencies */
  editTask: 'editTask',

  /** List tasks with optional filters */
  listTasks: 'listTasks',

  /** Trigger an async run of a single task (real execution, not just status) */
  runTask: 'runTask',

  /** Trigger async runs for multiple tasks in one call */
  runTasks: 'runTasks',

  /** Update a task's status (e.g. complete, cancel) */
  updateTaskStatus: 'updateTaskStatus',

  /** View details of a specific task */
  viewTask: 'viewTask',
} as const;

export type TaskApiNameType = (typeof TaskApiName)[keyof typeof TaskApiName];

// ==================== createTask ====================

export interface CreateTaskParams {
  assigneeAgentId?: string;
  instruction: string;
  name: string;
  parentIdentifier?: string;
  priority?: number;
  sortOrder?: number;
}

export interface CreateTaskState {
  identifier?: string;
  success: boolean;
}

// ==================== createTasks (batch) ====================

export interface CreateTasksParams {
  /** Array of tasks to create in a single call. */
  tasks: CreateTaskParams[];
}

export interface CreateTasksItemResult {
  error?: string;
  identifier?: string;
  name: string;
  success: boolean;
}

export interface CreateTasksState {
  /** Number of failed creations. */
  failed: number;
  results: CreateTasksItemResult[];
  /** Number of successful creations. */
  succeeded: number;
}

// ==================== listTasks ====================

export interface ListTasksParams {
  assigneeAgentId?: string;
  limit?: number;
  offset?: number;
  parentIdentifier?: string;
  priorities?: number[];
  statuses?: TaskStatus[];
}

export interface ListTasksState {
  count: number;
  success: boolean;
  total?: number;
}

// ==================== viewTask ====================

export interface ViewTaskParams {
  identifier?: string;
}

export interface ViewTaskState {
  identifier?: string;
  success: boolean;
}

// ==================== editTask ====================

export interface EditTaskParams {
  addDependencies?: string[];
  assigneeAgentId?: string | null;
  description?: string;
  identifier: string;
  instruction?: string;
  name?: string;
  priority?: number;
  removeDependencies?: string[];
}

export interface EditTaskState {
  identifier: string;
  success: boolean;
}

// ==================== runTask / runTasks ====================

export interface RunTaskParams {
  /** Optional existing topic to continue (rather than creating a new topic). */
  continueTopicId?: string;
  identifier: string;
  /** Optional extra prompt prepended to the task instruction for this run. */
  prompt?: string;
}

export interface RunTaskState {
  identifier: string;
  operationId?: string;
  success: boolean;
  topicId?: string;
}

export interface RunTasksParams {
  /** Identifiers of tasks to run, in execution order. */
  identifiers: string[];
}

export interface RunTasksItemResult {
  error?: string;
  identifier: string;
  operationId?: string;
  success: boolean;
  topicId?: string;
}

export interface RunTasksState {
  failed: number;
  results: RunTasksItemResult[];
  succeeded: number;
}

// ==================== updateTaskStatus ====================

export interface UpdateTaskStatusParams {
  error?: string;
  identifier?: string;
  status: TaskStatus;
}

export interface UpdateTaskStatusState {
  status: TaskStatus;
  success: boolean;
}

// ==================== deleteTask ====================

export interface DeleteTaskParams {
  identifier: string;
}

export interface DeleteTaskState {
  identifier: string;
  success: boolean;
}
