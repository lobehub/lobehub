import type { taskService } from '@/services/task';

// Derive types from TRPC inference via service
export type TaskListItem = Awaited<ReturnType<typeof taskService.list>>['data'][number];
export type TaskGroupItem = Awaited<ReturnType<typeof taskService.groupList>>['data'][number];

export type TaskViewMode = 'kanban' | 'list';

/**
 * Top-of-list visibility chip selection:
 *   - 'all'       → don't narrow further, show every visible task
 *   - 'private'   → only `tasks.visibility = 'private'` (creator-only)
 *   - 'workspace' → only `tasks.visibility = 'public'` (workspace-shared)
 *
 * Personal mode hides the chip and treats every entry as 'all'.
 */
export type TaskListVisibilityFilter = 'all' | 'private' | 'workspace';

export interface TaskListSliceState {
  isScheduledTaskListInit: boolean;
  isTaskGroupListInit: boolean;
  isTaskListInit: boolean;
  listAgentId?: string;
  /** Effective visibility of the task data currently stored in `tasks`. */
  listQueryVisibility: TaskListVisibilityFilter;
  /** Defaults to 'all' so the Tasks top entry shows every visible task
   *  (private + workspace-shared) without narrowing. */
  listVisibility: TaskListVisibilityFilter;
  /** Tasks driven by a schedule or heartbeat — a separate query from `tasks`. */
  scheduledTasks: TaskListItem[];
  scheduledTasksTotal: number;
  taskGroups: TaskGroupItem[];
  tasks: TaskListItem[];
  tasksTotal: number;
  viewMode: TaskViewMode;
}

export const initialTaskListSliceState: TaskListSliceState = {
  isScheduledTaskListInit: false,
  isTaskGroupListInit: false,
  isTaskListInit: false,
  listQueryVisibility: 'all',
  listVisibility: 'all',
  scheduledTasks: [],
  scheduledTasksTotal: 0,
  taskGroups: [],
  tasks: [],
  tasksTotal: 0,
  viewMode: 'list',
};
