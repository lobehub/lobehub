import type { taskService } from '@/services/task';

// Derive types from TRPC inference via service
export type TaskListItem = Awaited<ReturnType<typeof taskService.list>>['data'][number];
export type TaskGroupItem = Awaited<ReturnType<typeof taskService.groupList>>['data'][number];

/**
 * Top-of-list visibility chip selection:
 *   - 'all'       → don't narrow further, show every visible task
 *   - 'private'   → only `tasks.visibility = 'private'` (creator-only)
 *   - 'workspace' → only `tasks.visibility = 'public'` (workspace-shared)
 *
 * Personal mode hides the chip and treats every entry as 'all'.
 */
export type TaskListVisibilityFilter = 'all' | 'private' | 'workspace';
export type TaskKanbanGroupBy = 'assignee' | 'member' | 'priority' | 'status';

export interface TaskListSliceState {
  groupListQueryAutomated?: boolean;
  isTaskGroupListInit: boolean;
  isTaskListInit: boolean;
  listAgentId?: string;
  /** Grouping dimension of the task data currently stored in `taskGroups`. */
  listGroupBy: TaskKanbanGroupBy;
  /** Excluded statuses of the current grouped query, as a sorted signature. */
  listGroupExcludeStatuses?: string;
  /**
   * Automation filter of the task data currently stored in `tasks` — `false`
   * for Home's recent block (live schedules excluded server-side), undefined
   * for the unfiltered Tasks page. Tracked like `listQueryVisibility` so a
   * scope change resets the shared field instead of rendering the other
   * surface's filter.
   */
  listQueryAutomated?: boolean;
  /**
   * Status narrowing of the data in `tasks`, as an order-insensitive signature
   * (sorted, comma-joined) — undefined when the query is unnarrowed. Tracked
   * for the same scope-reset reason as `listQueryAutomated`.
   */
  listQueryStatuses?: string;
  /** Effective visibility of the task data currently stored in `tasks`. */
  listQueryVisibility: TaskListVisibilityFilter;
  /** Defaults to 'all' so the Tasks top entry shows every visible task
   *  (private + workspace-shared) without narrowing. */
  listVisibility: TaskListVisibilityFilter;
  taskGroups: TaskGroupItem[];
  tasks: TaskListItem[];
  tasksTotal: number;
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
};
