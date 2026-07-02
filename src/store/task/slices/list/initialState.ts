import type { taskService } from '@/services/task';

// Derive types from TRPC inference via service
export type TaskListItem = Awaited<ReturnType<typeof taskService.list>>['data'][number];
export type TaskGroupItem = Awaited<ReturnType<typeof taskService.groupList>>['data'][number];

export type TaskViewMode = 'kanban' | 'list';

/**
 * Top-of-list visibility chip selection (LOBE-10973):
 *   - 'all'       → don't narrow further, show every visible task
 *   - 'private'   → only `tasks.visibility = 'private'` (creator-only)
 *   - 'workspace' → only `tasks.visibility = 'public'` (workspace-shared)
 *
 * Personal mode hides the chip and treats every entry as 'all'.
 */
export type TaskListVisibilityFilter = 'all' | 'private' | 'workspace';

export interface TaskListSliceState {
  isTaskGroupListInit: boolean;
  isTaskListInit: boolean;
  listAgentId?: string;
  /** Defaults to 'all' so the Tasks top entry shows every visible task
   *  (private + workspace-shared) without narrowing. */
  listVisibility: TaskListVisibilityFilter;
  taskGroups: TaskGroupItem[];
  tasks: TaskListItem[];
  tasksTotal: number;
  viewMode: TaskViewMode;
}

export const initialTaskListSliceState: TaskListSliceState = {
  isTaskGroupListInit: false,
  isTaskListInit: false,
  listVisibility: 'all',
  taskGroups: [],
  tasks: [],
  tasksTotal: 0,
  viewMode: 'list',
};
