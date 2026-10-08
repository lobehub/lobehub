import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { taskService } from '@/services/task';

import type { TaskGroupListValue, TaskListValue } from './projection';

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
  /**
   * The list the Tasks page is showing (`taskListMap` key) — what the task
   * manager agent sees as "the viewed list".
   */
  activeTaskListKey?: string;
  /** Defaults to 'all' so the Tasks top entry shows every visible task
   *  (private + workspace-shared) without narrowing. */
  listVisibility: TaskListVisibilityFilter;
  /** Replica view of the kanban groups, one entry per board query (`taskGroupListQueryKey`). */
  taskGroupListMap: Record<string, TaskGroupListValue>;
  /** Replica bookkeeping of `taskGroupListMap`. */
  taskGroupListReplica: ReplicaState<TaskGroupListValue>;
  /** Replica view of the task lists, one entry per list query (`taskListQueryKey`). */
  taskListMap: Record<string, TaskListValue>;
  /** Replica bookkeeping of `taskListMap`. */
  taskListReplica: ReplicaState<TaskListValue>;
}

export const initialTaskListSliceState: TaskListSliceState = {
  listVisibility: 'all',
  taskGroupListMap: {},
  taskGroupListReplica: createReplicaState(),
  taskListMap: {},
  taskListReplica: createReplicaState(),
};
