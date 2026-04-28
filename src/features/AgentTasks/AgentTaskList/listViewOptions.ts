import { t } from 'i18next';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

export type TaskGroupBy = 'assignee' | 'none' | 'priority' | 'status';
export type TaskOrderBy = 'assignee' | 'createdAt' | 'priority' | 'status' | 'title' | 'updatedAt';
export type TaskOrderDirection = 'asc' | 'desc';

export interface TaskListViewOptions {
  groupBy: TaskGroupBy;
  hideCompleted: boolean;
  orderBy: TaskOrderBy;
  orderCompletedByRecency: boolean;
  orderDirection: TaskOrderDirection;
  subGroupBy: TaskGroupBy;
}

export const HIDDEN_WHEN_COMPLETED_STATUSES: ReadonlyArray<NonNullable<TaskGroupMeta['status']>> = [
  'completed',
  'canceled',
];

export interface TaskGroupMeta {
  assigneeId?: string;
  groupBy: TaskGroupBy;
  key: string;
  label: string;
  priority?: number;
  status?: 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';
}

export const DEFAULT_TASK_LIST_VIEW_OPTIONS: TaskListViewOptions = {
  groupBy: 'status',
  hideCompleted: true,
  orderBy: 'updatedAt',
  orderCompletedByRecency: true,
  orderDirection: 'asc',
  subGroupBy: 'none',
};

const TASK_GROUP_BY_SET = new Set<TaskGroupBy>(['assignee', 'none', 'priority', 'status']);
const TASK_ORDER_BY_SET = new Set<TaskOrderBy>([
  'assignee',
  'createdAt',
  'priority',
  'status',
  'title',
  'updatedAt',
]);
const TASK_ORDER_DIRECTION_SET = new Set<TaskOrderDirection>(['asc', 'desc']);

export const normalizeTaskListViewOptions = (
  value?: Partial<TaskListViewOptions> | null,
): TaskListViewOptions => {
  const next = value ?? {};
  const groupBy = TASK_GROUP_BY_SET.has(next.groupBy as TaskGroupBy)
    ? (next.groupBy as TaskGroupBy)
    : DEFAULT_TASK_LIST_VIEW_OPTIONS.groupBy;
  const subGroupBy = TASK_GROUP_BY_SET.has(next.subGroupBy as TaskGroupBy)
    ? (next.subGroupBy as TaskGroupBy)
    : DEFAULT_TASK_LIST_VIEW_OPTIONS.subGroupBy;

  return {
    groupBy,
    hideCompleted:
      typeof next.hideCompleted === 'boolean'
        ? next.hideCompleted
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.hideCompleted,
    orderBy: TASK_ORDER_BY_SET.has(next.orderBy as TaskOrderBy)
      ? (next.orderBy as TaskOrderBy)
      : DEFAULT_TASK_LIST_VIEW_OPTIONS.orderBy,
    orderCompletedByRecency:
      typeof next.orderCompletedByRecency === 'boolean'
        ? next.orderCompletedByRecency
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.orderCompletedByRecency,
    orderDirection: TASK_ORDER_DIRECTION_SET.has(next.orderDirection as TaskOrderDirection)
      ? (next.orderDirection as TaskOrderDirection)
      : DEFAULT_TASK_LIST_VIEW_OPTIONS.orderDirection,
    subGroupBy: groupBy === 'none' || subGroupBy !== groupBy ? subGroupBy : 'none',
  };
};

const PRIORITY_RANK_MAP: Record<number, number> = {
  0: 4,
  1: 0,
  2: 1,
  3: 2,
  4: 3,
};

const STATUS_GROUP_RANK_MAP: Record<NonNullable<TaskGroupMeta['status']>, number> = {
  backlog: 0,
  running: 1,
  paused: 2,
  completed: 3,
  failed: 4,
  canceled: 5,
};

const TASK_STATUS_TO_GROUP_MAP: Record<string, NonNullable<TaskGroupMeta['status']>> = {
  backlog: 'backlog',
  canceled: 'canceled',
  completed: 'completed',
  failed: 'failed',
  paused: 'paused',
  running: 'running',
};

const getPriorityValue = (task: TaskListItem) => task.priority ?? 0;
const getTaskStatusGroup = (task: TaskListItem): NonNullable<TaskGroupMeta['status']> =>
  TASK_STATUS_TO_GROUP_MAP[task.status] ?? 'backlog';

const getTaskAssigneeMeta = (task: TaskListItem): TaskGroupMeta => {
  const agentId = task.assigneeAgentId;
  if (!agentId) {
    return {
      groupBy: 'assignee',
      key: 'assignee:unassigned',
      label: t('taskList.unassigned', { ns: 'chat' }),
    };
  }

  return {
    assigneeId: agentId,
    groupBy: 'assignee',
    key: `assignee:${agentId}`,
    label: agentId,
  };
};

const getTaskAssigneeSortValue = (task: TaskListItem) => task.assigneeAgentId ?? '';

const toTime = (value: Date | string | null | undefined): number => {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

const compareNumbers = (a: number, b: number, direction: TaskOrderDirection) => {
  return direction === 'asc' ? a - b : b - a;
};

const compareStrings = (a: string, b: string, direction: TaskOrderDirection) => {
  return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
};

const getComparableValue = (task: TaskListItem, orderBy: TaskOrderBy): number | string => {
  switch (orderBy) {
    case 'assignee': {
      return getTaskAssigneeSortValue(task);
    }
    case 'createdAt': {
      return toTime(task.createdAt);
    }
    case 'priority': {
      return PRIORITY_RANK_MAP[getPriorityValue(task)];
    }
    case 'status': {
      return STATUS_GROUP_RANK_MAP[getTaskStatusGroup(task)];
    }
    case 'title': {
      return task.name || task.identifier;
    }
    case 'updatedAt': {
      return toTime(task.updatedAt);
    }
  }
};

export const compareTaskItems = (
  a: TaskListItem,
  b: TaskListItem,
  options: TaskListViewOptions,
): number => {
  const { orderBy, orderCompletedByRecency, orderDirection } = options;
  const effectiveOrderDirection =
    orderBy === 'createdAt' || orderBy === 'updatedAt'
      ? orderDirection === 'asc'
        ? 'desc'
        : 'asc'
      : orderDirection;

  if (orderCompletedByRecency && a.status === 'completed' && b.status === 'completed') {
    const byCompletedAt = compareNumbers(
      toTime(a.completedAt) || toTime(a.updatedAt),
      toTime(b.completedAt) || toTime(b.updatedAt),
      'desc',
    );
    if (byCompletedAt !== 0) return byCompletedAt;
  }

  const valueA = getComparableValue(a, orderBy);
  const valueB = getComparableValue(b, orderBy);
  const compared =
    typeof valueA === 'number' && typeof valueB === 'number'
      ? compareNumbers(valueA, valueB, effectiveOrderDirection)
      : compareStrings(String(valueA), String(valueB), effectiveOrderDirection);

  if (compared !== 0) return compared;
  return compareStrings(a.identifier, b.identifier, 'asc');
};

export const getTaskGroupMeta = (task: TaskListItem, groupBy: TaskGroupBy): TaskGroupMeta => {
  switch (groupBy) {
    case 'assignee': {
      return getTaskAssigneeMeta(task);
    }
    case 'priority': {
      const priority = getPriorityValue(task);
      const labelKeyMap: Record<number, string> = {
        0: 'taskDetail.priority.none',
        1: 'taskDetail.priority.urgent',
        2: 'taskDetail.priority.high',
        3: 'taskDetail.priority.normal',
        4: 'taskDetail.priority.low',
      };
      return {
        groupBy: 'priority',
        key: `priority:${priority}`,
        label: t(labelKeyMap[priority] ?? labelKeyMap[0], { defaultValue: '', ns: 'chat' }),
        priority,
      };
    }
    case 'status': {
      const groupedStatus = getTaskStatusGroup(task);
      const labelKeyMap: Record<NonNullable<TaskGroupMeta['status']>, string> = {
        backlog: 'taskDetail.status.backlog',
        canceled: 'taskDetail.status.canceled',
        completed: 'taskDetail.status.completed',
        failed: 'taskDetail.status.failed',
        paused: 'taskDetail.status.paused',
        running: 'taskDetail.status.running',
      };
      return {
        groupBy: 'status',
        key: `status:${groupedStatus}`,
        label: t(labelKeyMap[groupedStatus], { defaultValue: '', ns: 'chat' }),
        status: groupedStatus,
      };
    }
    case 'none': {
      return {
        groupBy: 'none',
        key: 'all',
        label: t('taskList.all', { ns: 'chat' }),
      };
    }
  }
};

const getGroupRank = (group: TaskGroupMeta, groupBy: TaskGroupBy): number => {
  switch (groupBy) {
    case 'priority': {
      if (group.priority === undefined) return Number.MAX_SAFE_INTEGER;
      return PRIORITY_RANK_MAP[group.priority] ?? Number.MAX_SAFE_INTEGER;
    }
    case 'status': {
      if (!group.status) return Number.MAX_SAFE_INTEGER;
      return STATUS_GROUP_RANK_MAP[group.status] ?? Number.MAX_SAFE_INTEGER;
    }
    default: {
      return Number.MAX_SAFE_INTEGER;
    }
  }
};

export const sortGroupEntries = (
  entries: Array<[TaskGroupMeta, TaskListItem[]]>,
  groupBy: TaskGroupBy,
  orderDirection?: TaskOrderDirection,
): Array<[TaskGroupMeta, TaskListItem[]]> => {
  if (groupBy === 'none') return entries;
  const direction = orderDirection ?? 'asc';

  return [...entries].sort(([groupA], [groupB]) => {
    const rankA = getGroupRank(groupA, groupBy);
    const rankB = getGroupRank(groupB, groupBy);
    if (rankA !== rankB) return direction === 'asc' ? rankA - rankB : rankB - rankA;
    return direction === 'asc'
      ? groupA.label.localeCompare(groupB.label)
      : groupB.label.localeCompare(groupA.label);
  });
};
