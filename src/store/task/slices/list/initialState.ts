import type { taskService } from '@/services/task';

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
export type TaskKanbanGroupBy = 'assignee' | 'priority' | 'status';

export interface TaskListSliceState {
  groupListQueryAutomated?: boolean;
  isTaskGroupListInit: boolean;
  isTaskListInit: boolean;
  listAgentId?: string;
  listGroupBy: TaskKanbanGroupBy;
  listGroupExcludeStatuses?: string;
  listQueryAutomated?: boolean;
  listQueryStatuses?: string;
  listQueryVisibility: TaskListVisibilityFilter;
  listVisibility: TaskListVisibilityFilter;
  taskGroups: TaskGroupItem[];
  tasks: TaskListItem[];
  tasksTotal: number;
  viewMode: TaskViewMode;
}

export const initialTaskListSliceState: TaskListSliceState = {
  groupListQueryAutomated: undefined,
  isTaskGroupListInit: false,
  isTaskListInit: false,
  listGroupBy: 'status',
  listQueryVisibility: 'all',
  listVisibility: 'all',
  taskGroups: [],
  tasks: [],
  tasksTotal: 0,
  viewMode: 'list',
};
