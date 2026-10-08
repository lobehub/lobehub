import type { TaskStatus } from '@lobechat/types';

import { defineReplica, type ReplicaEntityAdapter, stableQueryKey } from '@/libs/replica';
import type { taskService } from '@/services/task';

import type {
  TaskGroupItem,
  TaskKanbanGroupBy,
  TaskListItem,
  TaskListVisibilityFilter,
} from './initialState';

type TaskListResponse = Awaited<ReturnType<typeof taskService.list>>;
/** A card on the board (the group endpoint's row shape). */
export type TaskGroupTask = TaskGroupItem['tasks'][number];
/** A task as either collection holds it; both carry `identifier` and `status`. */
export type CollectionTask = TaskGroupTask | TaskListItem;
type TaskGroupListResponse = Awaited<ReturnType<typeof taskService.groupList>>;

/**
 * Everything that decides which rows a task list holds. Each distinct query is
 * its own replica entry, so the Tasks page, Home's recent block and a project
 * page never share — or reset — one list.
 */
export interface TaskListQuery {
  /** Assignee filter; absent for all-agents and project scopes. */
  agentId?: string;
  automated?: boolean;
  /** Every page walked (the Tasks list view), or the first server page. */
  complete?: boolean;
  orderBy?: 'createdAt' | 'updatedAt';
  projectId?: string;
  /** Sorted, so the same status set is one entry. */
  statuses?: TaskStatus[];
  visibility: TaskListVisibilityFilter;
}

export interface TaskListValue {
  items: TaskListItem[];
  /** The query's status filter, so a status change can drop a row it no longer matches. */
  statuses?: TaskStatus[];
  total: number;
}

export interface TaskGroupListQuery {
  agentId?: string;
  automated?: boolean;
  /** Sorted. */
  excludeStatuses?: TaskStatus[];
  groupBy: TaskKanbanGroupBy;
  projectId?: string;
  /** "My tasks" board. */
  scope?: 'assigned' | 'created';
  visibility: TaskListVisibilityFilter;
}

export interface TaskGroupListValue {
  /** The board's hidden statuses, so a status change can drop a card it no longer shows. */
  excludeStatuses?: TaskStatus[];
  groupBy: TaskKanbanGroupBy;
  groups: TaskGroupItem[];
}

export const taskListQueryKey = (query: TaskListQuery) => stableQueryKey(query);
export const taskGroupListQueryKey = (query: TaskGroupListQuery) => stableQueryKey(query);

export const taskListResource = defineReplica<TaskListQuery, TaskListValue, TaskListResponse>({
  key: taskListQueryKey,
  name: 'taskList',
  storage: 'indexedDB',
  version: 1,
});

export const taskGroupListResource = defineReplica<
  TaskGroupListQuery,
  TaskGroupListValue,
  TaskGroupListResponse
>({
  key: taskGroupListQueryKey,
  name: 'taskGroupList',
  storage: 'indexedDB',
  version: 1,
});

/** Kanban column of a status when the board groups by status. */
export const taskGroupKeyByStatus: Record<TaskStatus, string> = {
  backlog: 'backlog',
  canceled: 'canceled',
  completed: 'done',
  failed: 'needsInput',
  paused: 'needsInput',
  running: 'running',
  scheduled: 'running',
};

/** Tasks are addressed by `identifier` (e.g. `T-12`) across the task store. */
export const taskListEntity: ReplicaEntityAdapter<TaskListValue, TaskListItem> = {
  has: (data, id) => data.items.some((task) => task.identifier === id),
  map: (data, id, fn) => {
    let removed = 0;
    let changed = false;
    const items: TaskListItem[] = [];
    for (const task of data.items) {
      if (task.identifier !== id) {
        items.push(task);
        continue;
      }
      let next = fn(task);
      // A row whose new status falls outside the query's filter leaves the list.
      if (next && data.statuses && !data.statuses.includes(next.status as TaskStatus))
        next = undefined;
      if (next !== task) changed = true;
      if (next === undefined) removed++;
      else items.push(next);
    }
    return changed ? { ...data, items, total: data.total - removed } : data;
  },
};

/**
 * A task inside the board's groups. On a status board a status change moves
 * the card to its new column (appended), keeping each column's `total` right.
 */
export const taskGroupListEntity: ReplicaEntityAdapter<TaskGroupListValue, TaskGroupTask> = {
  has: (data, id) =>
    data.groups.some((group) => group.tasks.some((task) => task.identifier === id)),
  map: (data, id, fn) => {
    const current = data.groups
      .flatMap((group) => group.tasks)
      .find((task) => task.identifier === id);
    if (!current) return data;
    let next = fn(current);
    if (next === current) return data;
    // A card whose new status the board hides (`hideCompleted`) leaves it, even
    // though the server still returns the hidden status's empty column.
    if (next && data.excludeStatuses?.includes(next.status as TaskStatus)) next = undefined;

    const status = next?.status as TaskStatus | undefined;
    const moves = data.groupBy === 'status' && next !== undefined && status !== current.status;
    const targetKey = moves && status ? taskGroupKeyByStatus[status] : undefined;
    const groups = data.groups.map((group) => {
      const contains = group.tasks.some((task) => task.identifier === id);
      if (moves) {
        const isTarget = group.key === targetKey;
        if (!contains && !isTarget) return group;
        const rest = group.tasks.filter((task) => task.identifier !== id);
        return {
          ...group,
          tasks: isTarget ? [...rest, next!] : rest,
          total: group.total - (contains ? 1 : 0) + (isTarget ? 1 : 0),
        };
      }
      if (!contains) return group;
      return {
        ...group,
        tasks: group.tasks.flatMap((task) =>
          task.identifier !== id ? [task] : next === undefined ? [] : [next],
        ),
        total: next === undefined ? group.total - 1 : group.total,
      };
    });
    return { ...data, groups };
  },
};
