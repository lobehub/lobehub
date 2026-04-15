import { INBOX_SESSION_ID } from '@lobechat/const';
import { t } from 'i18next';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

export type TaskGroupBy = 'assignee' | 'none' | 'priority' | 'status';
export type TaskOrderBy = 'assignee' | 'createdAt' | 'priority' | 'status' | 'title' | 'updatedAt';
export type TaskOrderDirection = 'asc' | 'desc';

export interface TaskListViewOptions {
  groupBy: TaskGroupBy;
  orderBy: TaskOrderBy;
  orderCompletedByRecency: boolean;
  orderDirection: TaskOrderDirection;
  subGroupBy: TaskGroupBy;
}

export interface TaskGroupMeta {
  assignee?: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string;
  };
  groupBy: TaskGroupBy;
  key: string;
  label: string;
  priority?: number;
  status?: 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';
}

export const DEFAULT_TASK_LIST_VIEW_OPTIONS: TaskListViewOptions = {
  groupBy: 'status',
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

const PRIORITY_LABEL_MAP: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

const PRIORITY_RANK_MAP: Record<number, number> = {
  0: 4,
  1: 0,
  2: 1,
  3: 2,
  4: 3,
};

const STATUS_GROUP_LABEL_MAP: Record<NonNullable<TaskGroupMeta['status']>, string> = {
  backlog: 'Backlog',
  canceled: 'Canceled',
  completed: 'Done',
  failed: 'Failed',
  paused: 'Paused',
  running: 'In progress',
};

const STATUS_GROUP_RANK_MAP: Record<NonNullable<TaskGroupMeta['status']>, number> = {
  completed: 0,
  failed: 1,
  running: 2,
  paused: 3,
  canceled: 4,
  backlog: 5,
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

const getTaskAssigneeMeta = (task: TaskListItem, inboxAgentId?: string): TaskGroupMeta => {
  const participant = task.participants.find((item) => item.type === 'agent');
  if (!participant) {
    return {
      groupBy: 'assignee',
      key: 'assignee:unassigned',
      label: 'Unassigned',
    };
  }

  const isInboxAgent =
    participant.id === INBOX_SESSION_ID || (!!inboxAgentId && participant.id === inboxAgentId);
  const displayTitle =
    participant.title?.trim() || (isInboxAgent ? 'Lobe AI' : t('defaultSession', { ns: 'common' }));

  return {
    assignee: {
      avatar: participant.avatar,
      backgroundColor: participant.backgroundColor,
      id: participant.id,
      title: displayTitle,
    },
    groupBy: 'assignee',
    key: `assignee:${participant.id}`,
    label: displayTitle,
  };
};

const getTaskAssigneeSortValue = (task: TaskListItem, inboxAgentId?: string) =>
  getTaskAssigneeMeta(task, inboxAgentId).label;

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

const getComparableValue = (
  task: TaskListItem,
  orderBy: TaskOrderBy,
  inboxAgentId?: string,
): number | string => {
  switch (orderBy) {
    case 'assignee': {
      return getTaskAssigneeSortValue(task, inboxAgentId);
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
  inboxAgentId?: string,
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

  const valueA = getComparableValue(a, orderBy, inboxAgentId);
  const valueB = getComparableValue(b, orderBy, inboxAgentId);
  const compared =
    typeof valueA === 'number' && typeof valueB === 'number'
      ? compareNumbers(valueA, valueB, effectiveOrderDirection)
      : compareStrings(String(valueA), String(valueB), effectiveOrderDirection);

  if (compared !== 0) return compared;
  return compareStrings(a.identifier, b.identifier, 'asc');
};

export const getTaskGroupMeta = (
  task: TaskListItem,
  groupBy: TaskGroupBy,
  inboxAgentId?: string,
): TaskGroupMeta => {
  switch (groupBy) {
    case 'assignee': {
      return getTaskAssigneeMeta(task, inboxAgentId);
    }
    case 'priority': {
      const priority = getPriorityValue(task);
      return {
        groupBy: 'priority',
        key: `priority:${priority}`,
        label: PRIORITY_LABEL_MAP[priority] ?? PRIORITY_LABEL_MAP[0],
        priority,
      };
    }
    case 'status': {
      const groupedStatus = getTaskStatusGroup(task);
      return {
        groupBy: 'status',
        key: `status:${groupedStatus}`,
        label: STATUS_GROUP_LABEL_MAP[groupedStatus],
        status: groupedStatus,
      };
    }
    case 'none': {
      return {
        groupBy: 'none',
        key: 'all',
        label: 'All tasks',
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
