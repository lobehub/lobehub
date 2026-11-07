import {
  TASK_COMPLETED_WINDOW_MS,
  TASK_COMPLETED_WINDOWS,
  TASK_STATUSES,
  type TaskCompletedWindow,
} from '@lobechat/builtin-tool-task';
import type { TaskStatus } from '@lobechat/types';
import { t } from 'i18next';

import { getTaskStoreState } from '@/store/task';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

/** Grouping by one label group: one group per label of that group, plus "no label". */
export type TaskLabelGroupBy = `label:${string}`;
export type TaskGroupBy =
  'assignee' | 'automationMode' | 'member' | 'none' | 'priority' | 'status' | TaskLabelGroupBy;

const TASK_LABEL_GROUP_BY_PREFIX = 'label:';

export const toTaskLabelGroupBy = (labelGroupId: string): TaskLabelGroupBy =>
  `${TASK_LABEL_GROUP_BY_PREFIX}${labelGroupId}`;

export const isTaskLabelGroupBy = (groupBy: string | undefined): groupBy is TaskLabelGroupBy =>
  !!groupBy &&
  groupBy.startsWith(TASK_LABEL_GROUP_BY_PREFIX) &&
  groupBy.length > TASK_LABEL_GROUP_BY_PREFIX.length;

/** The label group a `label:<groupId>` grouping groups by. */
export const getTaskLabelGroupId = (groupBy: string | undefined): string | undefined =>
  isTaskLabelGroupBy(groupBy) ? groupBy.slice(TASK_LABEL_GROUP_BY_PREFIX.length) : undefined;
export type TaskOrderBy = 'assignee' | 'createdAt' | 'priority' | 'status' | 'title' | 'updatedAt';
export type TaskOrderDirection = 'asc' | 'desc';
/**
 * Which completed and canceled tasks a list keeps: all of them, none, or only
 * those closed within a look-back window.
 */
export type TaskCompletedFilter = 'all' | 'none' | TaskCompletedWindow;

export const TASK_COMPLETED_FILTERS: readonly TaskCompletedFilter[] = [
  'all',
  ...TASK_COMPLETED_WINDOWS,
  'none',
];

export interface TaskListViewOptions {
  completedTasks: TaskCompletedFilter;
  groupBy: TaskGroupBy;
  /** Indent a shown sub-task under its parent instead of listing it as a peer. */
  nestedSubTasks: boolean;
  orderBy: TaskOrderBy;
  orderCompletedByRecency: boolean;
  orderDirection: TaskOrderDirection;
  /** Bring back the tasks the user archived; they stay out of every list by default. */
  showArchived: boolean;
  /** List sub-tasks whose parent is already on the list as rows of their own. */
  showSubTasks: boolean;
  subGroupBy: TaskGroupBy;
}

export const HIDDEN_WHEN_COMPLETED_STATUSES: ReadonlyArray<NonNullable<TaskGroupMeta['status']>> = [
  'completed',
  'canceled',
];

/**
 * Server-side counterpart of `completedTasks: 'none'`: the statuses a
 * paginated list has to request so the cut happens before `limit` / `offset`
 * instead of on the fetched page (which could otherwise come back empty while
 * older unfinished tasks exist). `undefined` means no status narrowing.
 */
export const getVisibleTaskStatuses = (
  options: Pick<TaskListViewOptions, 'completedTasks'>,
): TaskStatus[] | undefined =>
  options.completedTasks === 'none'
    ? TASK_STATUSES.filter((status) => !HIDDEN_COMPLETED_STATUS_SET.has(status))
    : undefined;

/** Server-side counterpart of a windowed `completedTasks`, sent as `completedWithin`. */
export const getCompletedWithin = (
  options: Pick<TaskListViewOptions, 'completedTasks'>,
): TaskCompletedWindow | undefined =>
  options.completedTasks === 'all' || options.completedTasks === 'none'
    ? undefined
    : options.completedTasks;

const HIDDEN_COMPLETED_STATUS_SET = new Set<string>(HIDDEN_WHEN_COMPLETED_STATUSES);

/**
 * Client-side `completedTasks` cut for a list fetched in full. Mirrors the
 * server's `closedAfter`: a closed task without `completedAt` (a canceled one)
 * is dated by `updatedAt`.
 */
export const isTaskHiddenByCompletedFilter = (
  task: Pick<TaskListItem, 'completedAt' | 'status' | 'updatedAt'>,
  completedTasks: TaskCompletedFilter,
  now = Date.now(),
): boolean => {
  if (completedTasks === 'all' || !HIDDEN_COMPLETED_STATUS_SET.has(task.status)) return false;
  if (completedTasks === 'none') return true;
  const closedAt = toTime(task.completedAt) || toTime(task.updatedAt);
  return closedAt < now - TASK_COMPLETED_WINDOW_MS[completedTasks];
};

export interface TaskGroupMeta {
  assigneeId?: string;
  assigneeUserId?: string;
  automationMode?: 'heartbeat' | 'schedule';
  groupBy: TaskGroupBy;
  key: string;
  label: string;
  /** Label color of a label group (`groupBy` is `label:<groupId>`). */
  labelColor?: string | null;
  /** The label of a label group; null is the "no label" group. */
  labelId?: string | null;
  /** Registry position of a label group, for ordering. */
  labelRank?: number;
  priority?: number;
  status?: 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running' | 'scheduled';
}

export const DEFAULT_TASK_LIST_VIEW_OPTIONS: TaskListViewOptions = {
  completedTasks: 'none',
  groupBy: 'status',
  // Nesting is the default *shape* for sub-tasks, but sub-tasks stay hidden
  // until asked for: a parent already carries its progress (`3/8`), so listing
  // its children as peers only pads the list with rows the parent stands for.
  nestedSubTasks: true,
  orderBy: 'updatedAt',
  orderCompletedByRecency: true,
  orderDirection: 'asc',
  showArchived: false,
  showSubTasks: false,
  subGroupBy: 'none',
};

const TASK_GROUP_BY_SET = new Set<TaskGroupBy>([
  'assignee',
  'automationMode',
  'member',
  'none',
  'priority',
  'status',
]);
const TASK_ORDER_BY_SET = new Set<TaskOrderBy>([
  'assignee',
  'createdAt',
  'priority',
  'status',
  'title',
  'updatedAt',
]);
const TASK_ORDER_DIRECTION_SET = new Set<TaskOrderDirection>(['asc', 'desc']);
const TASK_COMPLETED_FILTER_SET = new Set<TaskCompletedFilter>(TASK_COMPLETED_FILTERS);

/** View options as persisted, possibly by a release that only had `hideCompleted`. */
export type StoredTaskListViewOptions = Partial<TaskListViewOptions> & {
  /** Replaced by `completedTasks`: `true` → 'none', `false` → 'all'. */
  hideCompleted?: boolean;
};

const normalizeCompletedTasks = (next: StoredTaskListViewOptions): TaskCompletedFilter => {
  if (TASK_COMPLETED_FILTER_SET.has(next.completedTasks as TaskCompletedFilter)) {
    return next.completedTasks as TaskCompletedFilter;
  }
  if (typeof next.hideCompleted === 'boolean') return next.hideCompleted ? 'none' : 'all';
  return DEFAULT_TASK_LIST_VIEW_OPTIONS.completedTasks;
};

/**
 * The shape to persist. Keeps writing the legacy `hideCompleted` beside
 * `completedTasks` so a build that predates the select (e.g. after a
 * rollback) still follows the latest choice; a windowed choice reads as
 * "shown" there, the closest it can express.
 */
export const toStoredTaskListViewOptions = <T extends Pick<TaskListViewOptions, 'completedTasks'>>(
  options: T,
): T & { hideCompleted: boolean } => ({
  ...options,
  hideCompleted: options.completedTasks === 'none',
});

/**
 * A `label:<groupId>` grouping persists in view options, so it outlives the
 * label group it points at. Once the registry has loaded, fall back to the
 * default for a grouping whose group is gone — otherwise every board request
 * would keep asking the server to group by a deleted group. Before the
 * registry loads (`labelGroupIds` undefined) the choice is kept as-is.
 */
export const dropMissingLabelGroupings = <
  T extends Pick<TaskListViewOptions, 'groupBy' | 'subGroupBy'>,
>(
  options: T,
  labelGroupIds: ReadonlySet<string> | undefined,
): T => {
  if (!labelGroupIds) return options;
  const isMissing = (groupBy: TaskGroupBy) => {
    const groupId = getTaskLabelGroupId(groupBy);
    return !!groupId && !labelGroupIds.has(groupId);
  };
  const groupByMissing = isMissing(options.groupBy);
  const subGroupByMissing = isMissing(options.subGroupBy);
  if (!groupByMissing && !subGroupByMissing) return options;
  return {
    ...options,
    groupBy: groupByMissing ? DEFAULT_TASK_LIST_VIEW_OPTIONS.groupBy : options.groupBy,
    subGroupBy: subGroupByMissing ? DEFAULT_TASK_LIST_VIEW_OPTIONS.subGroupBy : options.subGroupBy,
  };
};

/**
 * A grouping the list can render, or `fallback`. `label:<groupId>` is
 * open-ended; whether its group still exists is settled upstream by
 * {@link dropMissingLabelGroupings}.
 */
export const normalizeTaskGroupBy = (
  value: TaskGroupBy | string | undefined,
  fallback: TaskGroupBy,
): TaskGroupBy => {
  if (!value) return fallback;
  if (isTaskLabelGroupBy(value)) return value;
  return TASK_GROUP_BY_SET.has(value as TaskGroupBy) ? (value as TaskGroupBy) : fallback;
};

export const normalizeTaskListViewOptions = (
  value?: StoredTaskListViewOptions | null,
): TaskListViewOptions => {
  const next = value ?? {};
  const isKnownGroupBy = (value: unknown): value is TaskGroupBy =>
    TASK_GROUP_BY_SET.has(value as TaskGroupBy) || isTaskLabelGroupBy(value as string);
  const groupBy = isKnownGroupBy(next.groupBy)
    ? next.groupBy
    : DEFAULT_TASK_LIST_VIEW_OPTIONS.groupBy;
  const subGroupBy = isKnownGroupBy(next.subGroupBy)
    ? next.subGroupBy
    : DEFAULT_TASK_LIST_VIEW_OPTIONS.subGroupBy;

  return {
    completedTasks: normalizeCompletedTasks(next),
    groupBy,
    nestedSubTasks:
      typeof next.nestedSubTasks === 'boolean'
        ? next.nestedSubTasks
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.nestedSubTasks,
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
    showArchived:
      typeof next.showArchived === 'boolean'
        ? next.showArchived
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.showArchived,
    showSubTasks:
      typeof next.showSubTasks === 'boolean'
        ? next.showSubTasks
        : DEFAULT_TASK_LIST_VIEW_OPTIONS.showSubTasks,
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
  paused: 0,
  failed: 1,
  running: 2,
  scheduled: 3,
  backlog: 4,
  completed: 5,
  canceled: 6,
};

const TASK_STATUS_TO_GROUP_MAP: Record<string, NonNullable<TaskGroupMeta['status']>> = {
  backlog: 'backlog',
  canceled: 'canceled',
  completed: 'completed',
  failed: 'failed',
  paused: 'paused',
  running: 'running',
  // Scheduled tasks are idle-until-next-run, not executing — keep them in their
  // own group instead of folding into "running" ("In progress"), whose label
  // would otherwise assert a state the task isn't in.
  scheduled: 'scheduled',
};

const getPriorityValue = (task: TaskListItem) => task.priority ?? 0;
const getTaskStatusGroup = (task: TaskListItem): NonNullable<TaskGroupMeta['status']> =>
  TASK_STATUS_TO_GROUP_MAP[task.status] ?? 'backlog';

export const getTaskAssigneeGroupMeta = (agentId: string | null | undefined): TaskGroupMeta => {
  if (agentId) {
    return {
      assigneeId: agentId,
      groupBy: 'assignee',
      key: `assignee:${agentId}`,
      label: agentId,
    };
  }

  return {
    groupBy: 'assignee',
    key: 'assignee:unassigned',
    label: t('taskList.unassigned', { ns: 'chat' }),
  };
};

export const getTaskMemberGroupMeta = (userId: string | null | undefined): TaskGroupMeta => {
  if (userId) {
    return {
      assigneeUserId: userId,
      groupBy: 'member',
      key: `member:${userId}`,
      label: userId,
    };
  }

  return {
    groupBy: 'member',
    key: 'member:unassigned',
    label: t('taskList.unassigned', { ns: 'chat' }),
  };
};

/**
 * Group meta of one label column in a `label:<groupId>` grouping. Name and
 * color come from the registry (an empty column has no task to read them
 * from), falling back to the task's own label ref.
 */
export const getTaskLabelGroupMeta = (
  groupBy: TaskLabelGroupBy,
  labelId: string | null | undefined,
  fallback?: { color?: string | null; name: string },
): TaskGroupMeta => {
  if (!labelId) {
    return {
      groupBy,
      key: 'label:none',
      label: t('taskLabel.noLabel', { ns: 'chat' }),
      labelId: null,
      labelRank: Number.MAX_SAFE_INTEGER,
    };
  }
  const registry = getTaskStoreState().taskLabels;
  const index = registry.findIndex((label) => label.id === labelId);
  const entry = index === -1 ? undefined : registry[index];
  return {
    groupBy,
    key: `label:${labelId}`,
    label: entry?.name ?? fallback?.name ?? labelId,
    labelColor: entry?.color ?? fallback?.color,
    labelId,
    labelRank: index === -1 ? Number.MAX_SAFE_INTEGER - 1 : index,
  };
};

const getTaskAssigneeSortValue = (task: TaskListItem) => task.assigneeAgentId ?? '';

export const getTaskPriorityGroupMeta = (
  priorityValue: number | null | undefined,
): TaskGroupMeta => {
  const priority = priorityValue ?? 0;
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
};

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
  if (isTaskLabelGroupBy(groupBy)) {
    const groupId = getTaskLabelGroupId(groupBy);
    const label = task.labels?.find((item) => item.parentId === groupId);
    return getTaskLabelGroupMeta(groupBy, label?.id, label);
  }
  switch (groupBy) {
    case 'assignee': {
      return getTaskAssigneeGroupMeta(task.assigneeAgentId);
    }
    case 'member': {
      return getTaskMemberGroupMeta(task.assigneeUserId);
    }
    case 'automationMode': {
      // Automated tasks created before automationMode was introduced are schedules.
      const automationMode = task.automationMode === 'heartbeat' ? 'heartbeat' : 'schedule';
      return {
        automationMode,
        groupBy: 'automationMode',
        key: `automationMode:${automationMode}`,
        label: t(`taskList.groupBy.${automationMode}`, { ns: 'chat' }),
      };
    }
    case 'priority': {
      return getTaskPriorityGroupMeta(getPriorityValue(task));
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
        scheduled: 'taskDetail.status.scheduled',
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
  if (isTaskLabelGroupBy(groupBy)) return group.labelRank ?? Number.MAX_SAFE_INTEGER;
  switch (groupBy) {
    case 'automationMode': {
      return group.automationMode === 'schedule' ? 0 : 1;
    }
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

export const groupTaskItems = (
  items: TaskListItem[],
  groupBy: TaskGroupBy,
  orderDirection?: TaskOrderDirection,
): Array<[TaskGroupMeta, TaskListItem[]]> => {
  const groups = new Map<string, { items: TaskListItem[]; meta: TaskGroupMeta }>();

  for (const task of items) {
    const meta = getTaskGroupMeta(task, groupBy);
    const bucket = groups.get(meta.key);

    if (bucket) {
      bucket.items.push(task);
    } else {
      groups.set(meta.key, { items: [task], meta });
    }
  }

  return sortGroupEntries(
    [...groups.values()].map((group) => [group.meta, group.items]),
    groupBy,
    orderDirection,
  );
};

/** Depth cap — guards a malformed parent chain from recursing without end. */
const MAX_NEST_DEPTH = 8;

export interface TaskRow {
  /** Indent level inside its group; 0 for a row that isn't nested. */
  depth: number;
  /**
   * True when the row exists only to anchor a nested child whose parent sits in
   * another group (or is hidden by the display options). It is rendered muted
   * and is not counted as one of the group's tasks.
   */
  isParentContext: boolean;
  task: TaskListItem;
}

/**
 * Drop the sub-tasks a listed parent already stands for.
 *
 * Membership — not `parentTaskId` alone — is what decides: a task whose parent
 * is absent from this list (a goal's child, a parent on another page) has no
 * row representing it, so hiding it would drop it from the page entirely.
 */
export const collapseSubTasks = (items: TaskListItem[]): TaskListItem[] => {
  const ids = new Set(items.map((item) => item.id));
  return items.filter((item) => !item.parentTaskId || !ids.has(item.parentTaskId));
};

/**
 * Lay a group's tasks out as indented rows, parents before their children.
 *
 * Grouping still keys off each task's own status/priority/assignee, so a
 * sub-task regularly lands in a group its parent isn't in. Such a child gets a
 * muted context row for its parent rather than sitting at the top level, where
 * an indent-free row would read as an unrelated task.
 */
export const buildTaskRows = (
  groupItems: TaskListItem[],
  options: {
    compare: (a: TaskListItem, b: TaskListItem) => number;
    nested: boolean;
    /** Every task on the list, keyed by id — resolves parents outside the group. */
    taskById: Map<string, TaskListItem>;
  },
): TaskRow[] => {
  const { compare, nested, taskById } = options;
  if (!nested) return groupItems.map((task) => ({ depth: 0, isParentContext: false, task }));

  interface TaskNode {
    children: string[];
    isParentContext: boolean;
    task: TaskListItem;
  }

  const nodes = new Map<string, TaskNode>();
  for (const task of groupItems) {
    nodes.set(task.id, { children: [], isParentContext: false, task });
  }

  const parentOf = new Map<string, string>();
  const roots: string[] = [];

  // Every node holds at most one parent link, so a cycle can only close on the
  // edge being added — walking up from the parent is enough to rule it out.
  const isDescendantOf = (ancestorId: string, id: string) => {
    let current: string | undefined = id;
    for (let depth = 0; current && depth <= MAX_NEST_DEPTH; depth += 1) {
      if (current === ancestorId) return true;
      current = parentOf.get(current);
    }
    return false;
  };

  for (const task of groupItems) {
    const parentId = task.parentTaskId;
    if (!parentId || parentId === task.id) {
      roots.push(task.id);
      continue;
    }

    let parentNode = nodes.get(parentId);
    if (!parentNode) {
      const parentTask = taskById.get(parentId);
      if (!parentTask) {
        roots.push(task.id);
        continue;
      }
      parentNode = { children: [], isParentContext: true, task: parentTask };
      nodes.set(parentId, parentNode);
      roots.push(parentId);
    }

    if (isDescendantOf(task.id, parentId)) {
      roots.push(task.id);
      continue;
    }

    parentNode.children.push(task.id);
    parentOf.set(task.id, parentId);
  }

  const sortIds = (ids: string[]) =>
    [...ids].sort((a, b) => compare(nodes.get(a)!.task, nodes.get(b)!.task));

  const rows: TaskRow[] = [];
  const visit = (id: string, depth: number) => {
    const node = nodes.get(id);
    if (!node) return;
    rows.push({ depth, isParentContext: node.isParentContext, task: node.task });
    if (depth >= MAX_NEST_DEPTH) return;
    for (const childId of sortIds(node.children)) visit(childId, depth + 1);
  };

  for (const id of sortIds(roots)) visit(id, 0);

  return rows;
};
