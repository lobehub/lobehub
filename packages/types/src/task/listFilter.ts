import type { TaskStatus } from './index';
import type { TaskLabelRef } from './label';

/**
 * The Tasks page filter (Linear-style "Add Filter"): a set of independent
 * conditions, one per field. Values inside one field are OR-ed, fields are
 * AND-ed with each other and with the page's own scope / display options.
 *
 * The server turns it into SQL (`buildTaskListFilters` in
 * `packages/database/src/models/taskListFilters.ts`); `matchesTaskListFilter`
 * below mirrors that SQL in JS so a locally edited row that no longer matches
 * leaves the list before the refetch lands. Keep the two in step.
 */

/** Stands for "no value" (no agent / no member / no project) inside a value set. */
export const TASK_LIST_FILTER_NONE = '__none__';

/**
 * Prefix of an agent inside the `creator` set, so member and agent ids share
 * one value set. A member value matches every task that member created,
 * including those their agents created for them; an agent value matches the
 * tasks that agent created.
 */
export const TASK_LIST_FILTER_AGENT_CREATOR_PREFIX = 'agent:';

export const toTaskListFilterAgentCreator = (agentId: string) =>
  `${TASK_LIST_FILTER_AGENT_CREATOR_PREFIX}${agentId}`;

export const TASK_LIST_FILTER_OPERATORS = ['is', 'isNot'] as const;
export type TaskListFilterOperator = (typeof TASK_LIST_FILTER_OPERATORS)[number];

export interface TaskListFilterSet<T extends number | string = string> {
  operator: TaskListFilterOperator;
  values: T[];
}

/** Relative look-back windows, so a stored filter keeps meaning "recent" as time passes. */
export const TASK_LIST_FILTER_DATE_WINDOWS = ['day', 'week', 'month', 'quarter'] as const;
export type TaskListFilterDateWindow = (typeof TASK_LIST_FILTER_DATE_WINDOWS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export const TASK_LIST_FILTER_DATE_WINDOW_MS: Record<TaskListFilterDateWindow, number> = {
  day: DAY_MS,
  month: 30 * DAY_MS,
  quarter: 90 * DAY_MS,
  week: 7 * DAY_MS,
};

/** `within` → on or after the cut-off, `before` → strictly older than it. */
export const TASK_LIST_FILTER_DATE_OPERATORS = ['within', 'before'] as const;
export type TaskListFilterDateOperator = (typeof TASK_LIST_FILTER_DATE_OPERATORS)[number];

export interface TaskListFilterDate {
  operator: TaskListFilterDateOperator;
  window: TaskListFilterDateWindow;
}

export const TASK_LIST_FILTER_SET_FIELDS = [
  'status',
  'priority',
  'agent',
  'assignee',
  'creator',
  'project',
  'label',
] as const;
export type TaskListFilterSetField = (typeof TASK_LIST_FILTER_SET_FIELDS)[number];

export const TASK_LIST_FILTER_DATE_FIELDS = ['createdAt', 'updatedAt', 'completedAt'] as const;
export type TaskListFilterDateField = (typeof TASK_LIST_FILTER_DATE_FIELDS)[number];

export type TaskListFilterField = TaskListFilterDateField | TaskListFilterSetField | 'content';

export interface TaskListFilter {
  /** Executor agent (`assigneeAgentId`); may hold `TASK_LIST_FILTER_NONE`. */
  agent?: TaskListFilterSet<string>;
  /** Member assignee (`assigneeUserId`); may hold `TASK_LIST_FILTER_NONE`. */
  assignee?: TaskListFilterSet<string>;
  completedAt?: TaskListFilterDate;
  /** Case-insensitive substring of the name, identifier, description or instruction. */
  content?: string;
  createdAt?: TaskListFilterDate;
  /**
   * Member ids match `createdByUserId`; `agent:<id>` values
   * (`toTaskListFilterAgentCreator`) match `createdByAgentId`.
   */
  creator?: TaskListFilterSet<string>;
  /**
   * Label ids. A task matches a value when it carries that label, or — for a
   * label group's id — any label of that group. `TASK_LIST_FILTER_NONE`
   * stands for "no labels at all". `is` matches any value, `isNot` none.
   */
  label?: TaskListFilterSet<string>;
  /** `priority`, a missing one counting as 0 ("no priority"). */
  priority?: TaskListFilterSet<number>;
  /** `projectId`; may hold `TASK_LIST_FILTER_NONE`. */
  project?: TaskListFilterSet<string>;
  status?: TaskListFilterSet<TaskStatus>;
  updatedAt?: TaskListFilterDate;
}

/** Longest `content` the filter keeps; anything past it is trimmed. */
export const TASK_LIST_FILTER_CONTENT_MAX_LENGTH = 200;
/** Most values one field may hold; `task.list` / `task.groupList` reject more. */
export const TASK_LIST_FILTER_MAX_VALUES = 100;

const sortValues = <T extends number | string>(values: T[]): T[] =>
  [...new Set(values)].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );

const normalizeSet = <T extends number | string>(
  set: TaskListFilterSet<T> | undefined,
): TaskListFilterSet<T> | undefined => {
  if (!set || !Array.isArray(set.values) || set.values.length === 0) return undefined;
  return {
    operator: set.operator === 'isNot' ? 'isNot' : 'is',
    values: sortValues(set.values),
  };
};

const normalizeDate = (date: TaskListFilterDate | undefined): TaskListFilterDate | undefined => {
  if (!date || !(TASK_LIST_FILTER_DATE_WINDOWS as readonly string[]).includes(date.window)) {
    return undefined;
  }
  return { operator: date.operator === 'before' ? 'before' : 'within', window: date.window };
};

/**
 * Canonical form: empty conditions dropped, value sets de-duplicated and
 * sorted, so the same filter is always one query key. `undefined` when
 * nothing is left — an empty filter and no filter are the same query.
 */
export const normalizeTaskListFilter = (
  filter: TaskListFilter | null | undefined,
): TaskListFilter | undefined => {
  if (!filter) return undefined;
  const content = filter.content?.trim().slice(0, TASK_LIST_FILTER_CONTENT_MAX_LENGTH);
  const next: TaskListFilter = {
    agent: normalizeSet(filter.agent),
    assignee: normalizeSet(filter.assignee),
    completedAt: normalizeDate(filter.completedAt),
    content: content || undefined,
    createdAt: normalizeDate(filter.createdAt),
    creator: normalizeSet(filter.creator),
    label: normalizeSet(filter.label),
    priority: normalizeSet(filter.priority),
    project: normalizeSet(filter.project),
    status: normalizeSet(filter.status),
    updatedAt: normalizeDate(filter.updatedAt),
  };
  const entries = Object.entries(next).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as TaskListFilter) : undefined;
};

/** Number of active conditions, for the header badge. */
export const countTaskListFilterConditions = (filter: TaskListFilter | undefined): number =>
  filter ? Object.values(normalizeTaskListFilter(filter) ?? {}).length : 0;

export const resolveTaskListFilterDateCutoff = (
  window: TaskListFilterDateWindow,
  now = Date.now(),
): Date => new Date(now - TASK_LIST_FILTER_DATE_WINDOW_MS[window]);

/** The row fields `matchesTaskListFilter` reads. */
export interface TaskListFilterTarget {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  description?: string | null;
  identifier?: string | null;
  instruction?: string | null;
  /** Labels the row carries; a row without the field counts as unlabeled. */
  labels?: Pick<TaskLabelRef, 'id' | 'parentId'>[] | null;
  name?: string | null;
  priority?: number | null;
  projectId?: string | null;
  status: string;
  updatedAt?: Date | string | null;
}

const matchesSet = <T extends number | string>(
  set: TaskListFilterSet<T> | undefined,
  value: T | null | undefined,
  noneValue?: T,
): boolean => {
  if (!set || set.values.length === 0) return true;
  const key = value ?? noneValue;
  const included = key !== undefined && set.values.includes(key);
  return set.operator === 'isNot' ? !included : included;
};

/** A task matches a creator value through its member or through its agent. */
const matchesCreator = (
  set: TaskListFilterSet<string> | undefined,
  task: TaskListFilterTarget,
): boolean => {
  if (!set || set.values.length === 0) return true;
  const included =
    (!!task.createdByUserId && set.values.includes(task.createdByUserId)) ||
    (!!task.createdByAgentId &&
      set.values.includes(toTaskListFilterAgentCreator(task.createdByAgentId)));
  return set.operator === 'isNot' ? !included : included;
};

/**
 * A label value matches a carried label by id, or a label group by any of its
 * labels; "none" matches a row without labels. Mirrors `buildLabelCondition`.
 */
const matchesLabels = (
  set: TaskListFilterSet<string> | undefined,
  task: TaskListFilterTarget,
): boolean => {
  if (!set || set.values.length === 0) return true;
  const labels = task.labels ?? [];
  const included =
    (set.values.includes(TASK_LIST_FILTER_NONE) && labels.length === 0) ||
    labels.some(
      (label) =>
        set.values.includes(label.id) || (!!label.parentId && set.values.includes(label.parentId)),
    );
  return set.operator === 'isNot' ? !included : included;
};

const toTime = (value: Date | string | null | undefined): number | undefined => {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
};

const matchesDate = (
  date: TaskListFilterDate | undefined,
  value: Date | string | null | undefined,
  now: number,
): boolean => {
  if (!date) return true;
  const time = toTime(value);
  // A missing timestamp (an unfinished task's `completedAt`) matches neither side.
  if (time === undefined) return false;
  const cutoff = resolveTaskListFilterDateCutoff(date.window, now).getTime();
  return date.operator === 'before' ? time < cutoff : time >= cutoff;
};

const matchesContent = (content: string | undefined, task: TaskListFilterTarget): boolean => {
  if (!content) return true;
  const needle = content.toLowerCase();
  return [task.name, task.identifier, task.description, task.instruction].some(
    (field) => !!field && field.toLowerCase().includes(needle),
  );
};

/**
 * JS mirror of the server's SQL for `filter`. Rows the server already
 * filtered always pass; it only drops a row whose local copy has changed
 * since (a priority edited, an assignee swapped) until the refetch lands.
 */
export const matchesTaskListFilter = (
  task: TaskListFilterTarget,
  filter: TaskListFilter | undefined,
  now = Date.now(),
): boolean => {
  if (!filter) return true;
  return (
    matchesSet(filter.status, task.status as TaskStatus) &&
    matchesSet(filter.priority, task.priority ?? 0) &&
    matchesSet(filter.agent, task.assigneeAgentId, TASK_LIST_FILTER_NONE) &&
    matchesSet(filter.assignee, task.assigneeUserId, TASK_LIST_FILTER_NONE) &&
    matchesCreator(filter.creator, task) &&
    matchesSet(filter.project, task.projectId, TASK_LIST_FILTER_NONE) &&
    matchesLabels(filter.label, task) &&
    matchesDate(filter.createdAt, task.createdAt, now) &&
    matchesDate(filter.updatedAt, task.updatedAt, now) &&
    matchesDate(filter.completedAt, task.completedAt, now) &&
    matchesContent(filter.content, task)
  );
};
