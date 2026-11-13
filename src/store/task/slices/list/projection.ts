import type { TaskCompletedWindow } from '@lobechat/builtin-tool-task';
import type { TaskListFilter, TaskStatus } from '@lobechat/types';

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
  /** Completed / canceled tasks closed outside this window are left out server-side. */
  completedWithin?: TaskCompletedWindow;
  /** The Tasks page filter, normalized (`normalizeTaskListFilter`) so equal filters share an entry. */
  filter?: TaskListFilter;
  /** Archived tasks are hidden unless the "Show archived" option is on. */
  includeArchived?: boolean;
  /** One server page of a paginated collection (scheduled / "My tasks"); ignored by `complete`. */
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  projectId?: string;
  /** "My tasks": assigned to, or created by, the caller. */
  scope?: 'assigned' | 'created';
  /** Sorted, so the same status set is one entry. */
  statuses?: TaskStatus[];
  visibility: TaskListVisibilityFilter;
}

export interface TaskListValue {
  items: TaskListItem[];
  /** The query's project scope, so a task moved elsewhere can drop out of this list. */
  projectId?: string;
  /** The query's status filter, so a status change can drop a row it no longer matches. */
  statuses?: TaskStatus[];
  total: number;
}

export interface TaskGroupListQuery {
  agentId?: string;
  automated?: boolean;
  /** Completed / canceled cards closed outside this window are left out server-side. */
  completedWithin?: TaskCompletedWindow;
  /** Sorted. */
  excludeStatuses?: TaskStatus[];
  /** Normalized, like `TaskListQuery.filter`. */
  filter?: TaskListFilter;
  groupBy: TaskKanbanGroupBy;
  includeArchived?: boolean;
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
  /** The query's project scope, so a task moved elsewhere can drop off this board. */
  projectId?: string;
}

export const taskListQueryKey = (query: TaskListQuery) => stableQueryKey(query);
export const taskGroupListQueryKey = (query: TaskGroupListQuery) => stableQueryKey(query);

export const taskListResource = defineReplica<TaskListQuery, TaskListValue, TaskListResponse>({
  key: taskListQueryKey,
  name: 'taskList',
  // Every scope, filter and collection page is its own row, and a `complete`
  // list holds up to 1000 tasks — keep only the recently opened ones.
  persist: { maxEntries: 40 },
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
  // One row per board and per agent sidebar panel.
  persist: { maxEntries: 40 },
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

/** The "No project" column of a board grouped by project. */
export const TASK_NO_PROJECT_GROUP_KEY = 'project:none';

/** The one column for tasks filed under projects the caller cannot see. */
export const TASK_UNAVAILABLE_PROJECT_GROUP_KEY = 'project:unavailable';

/** Kanban column of a task's project when the board groups by project. */
export const taskGroupKeyByProject = (projectId: string | null | undefined) =>
  projectId ? `project:${projectId}` : TASK_NO_PROJECT_GROUP_KEY;

/**
 * Whether a patched row left the project a collection is scoped to. A row without
 * the field (a card persisted before it was projected) proves nothing, so it stays.
 */
const leftProjectScope = (scope: string | undefined, task: CollectionTask) =>
  !!scope && task.projectId !== undefined && task.projectId !== scope;

/** Tasks are addressed by stable database id across the task store. */
export const taskListEntity: ReplicaEntityAdapter<TaskListValue, TaskListItem> = {
  has: (data, id) => data.items.some((task) => task.id === id),
  map: (data, id, fn) => {
    let removed = 0;
    let changed = false;
    const items: TaskListItem[] = [];
    for (const task of data.items) {
      if (task.id !== id) {
        items.push(task);
        continue;
      }
      let next = fn(task);
      // A row whose new status falls outside the query's filter leaves the list.
      if (next && data.statuses && !data.statuses.includes(next.status as TaskStatus))
        next = undefined;
      if (next && leftProjectScope(data.projectId, next)) next = undefined;
      if (next !== task) changed = true;
      if (next === undefined) removed++;
      else items.push(next);
    }
    return changed ? { ...data, items, total: data.total - removed } : data;
  },
};

/**
 * A task inside the board's groups. On a status board a status change moves
 * the card to its new column (appended), keeping each column's `total` right;
 * a project change does the same on a project board.
 */
export const taskGroupListEntity: ReplicaEntityAdapter<TaskGroupListValue, TaskGroupTask> = {
  has: (data, id) => data.groups.some((group) => group.tasks.some((task) => task.id === id)),
  map: (data, id, fn) => {
    const current = data.groups.flatMap((group) => group.tasks).find((task) => task.id === id);
    if (!current) return data;
    let next = fn(current);
    if (next === current) return data;
    // A card whose new status the board hides ("Completed tasks: None") leaves it, even
    // though the server still returns the hidden status's empty column.
    if (next && data.excludeStatuses?.includes(next.status as TaskStatus)) next = undefined;
    if (next && leftProjectScope(data.projectId, next)) next = undefined;

    const status = next?.status as TaskStatus | undefined;
    const movesStatus =
      data.groupBy === 'status' && next !== undefined && status !== current.status;
    const movesProject =
      data.groupBy === 'project' &&
      next !== undefined &&
      (next.projectId ?? null) !== (current.projectId ?? null);
    const moves = movesStatus || movesProject;
    const targetKey = movesProject
      ? taskGroupKeyByProject(next!.projectId)
      : movesStatus && status
        ? taskGroupKeyByStatus[status]
        : undefined;
    const groups = data.groups.map((group) => {
      const contains = group.tasks.some((task) => task.id === id);
      if (moves) {
        const isTarget = group.key === targetKey;
        if (!contains && !isTarget) return group;
        const rest = group.tasks.filter((task) => task.id !== id);
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
          task.id !== id ? [task] : next === undefined ? [] : [next],
        ),
        total: next === undefined ? group.total - 1 : group.total,
      };
    });
    // A project board only has columns for projects holding tasks, so the first
    // task of a project opens its column.
    if (movesProject && !groups.some((group) => group.key === targetKey)) {
      groups.push({
        hasMore: false,
        key: targetKey!,
        limit: 50,
        offset: 0,
        projectId: next!.projectId ?? null,
        tasks: [next!],
        total: 1,
      });
    }
    return { ...data, groups };
  },
};
