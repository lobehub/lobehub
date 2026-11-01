import {
  normalizeTaskListFilter,
  TASK_LIST_FILTER_MAX_VALUES,
  type TaskListFilter,
  type TaskListFilterDate,
  type TaskListFilterDateField,
  type TaskListFilterDateWindow,
  type TaskListFilterField,
  type TaskListFilterSet,
  type TaskListFilterSetField,
} from '@lobechat/types';

/** Value type of one set field (priority holds numbers, the rest strings). */
export type TaskFilterValue = number | string;

export interface TaskListFilterEntry {
  filter: TaskListFilter;
  scope: string;
}

/** Oldest scopes are dropped past this, so visiting many agents cannot grow the status blob forever. */
export const MAX_STORED_TASK_LIST_FILTERS = 50;

/**
 * Which list a filter belongs to. Each agent / project page keeps its own, and
 * the workspace is part of the key because the values (members, agents,
 * projects) only exist inside one workspace.
 */
export const taskListFilterScopeKey = ({
  agentId,
  projectId,
  workspaceId,
}: {
  agentId?: string;
  projectId?: string;
  workspaceId?: string | null;
}): string => {
  const space = workspaceId || 'personal';
  if (projectId) return `${space}:project:${projectId}`;
  if (agentId) return `${space}:agent:${agentId}`;
  return `${space}:global`;
};

/**
 * The stored list with `scope` set to `filter` (or removed when the filter is
 * empty). The touched scope moves to the end, so trimming keeps the most
 * recently used ones.
 */
export const upsertTaskListFilterEntry = (
  entries: readonly TaskListFilterEntry[],
  scope: string,
  filter: TaskListFilter | undefined,
): TaskListFilterEntry[] => {
  const rest = entries.filter((entry) => entry.scope !== scope);
  const normalized = normalizeTaskListFilter(filter);
  const next = normalized ? [...rest, { filter: normalized, scope }] : rest;
  return next.slice(-MAX_STORED_TASK_LIST_FILTERS);
};

const getSet = (
  filter: TaskListFilter | undefined,
  field: TaskListFilterSetField,
): TaskListFilterSet<TaskFilterValue> | undefined =>
  filter?.[field] as TaskListFilterSet<TaskFilterValue> | undefined;

export const isTaskFilterValueSelected = (
  filter: TaskListFilter | undefined,
  field: TaskListFilterSetField,
  value: TaskFilterValue,
): boolean => !!getSet(filter, field)?.values.includes(value);

/**
 * Add or remove one value; a new condition starts as "is". Adding past
 * `TASK_LIST_FILTER_MAX_VALUES` is ignored, since the list query would reject it.
 */
export const toggleTaskFilterValue = (
  filter: TaskListFilter | undefined,
  field: TaskListFilterSetField,
  value: TaskFilterValue,
): TaskListFilter | undefined => {
  const current = getSet(filter, field);
  const values = current?.values ?? [];
  if (!values.includes(value) && values.length >= TASK_LIST_FILTER_MAX_VALUES) return filter;
  const nextValues = values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
  return normalizeTaskListFilter({
    ...filter,
    [field]: { operator: current?.operator ?? 'is', values: nextValues },
  });
};

/** Flip "is" ↔ "is not" (sets) or "within" ↔ "before" (dates). */
export const toggleTaskFilterOperator = (
  filter: TaskListFilter | undefined,
  field: TaskListFilterDateField | TaskListFilterSetField,
): TaskListFilter | undefined => {
  const condition = filter?.[field];
  if (!filter || !condition) return filter;
  if ('window' in condition) {
    const date = condition as TaskListFilterDate;
    return normalizeTaskListFilter({
      ...filter,
      [field]: { ...date, operator: date.operator === 'within' ? 'before' : 'within' },
    });
  }
  const set = condition as TaskListFilterSet<TaskFilterValue>;
  return normalizeTaskListFilter({
    ...filter,
    [field]: { ...set, operator: set.operator === 'is' ? 'isNot' : 'is' },
  });
};

/** Pick a date window, keeping the current operator. */
export const setTaskFilterDateWindow = (
  filter: TaskListFilter | undefined,
  field: TaskListFilterDateField,
  window: TaskListFilterDateWindow,
): TaskListFilter | undefined =>
  normalizeTaskListFilter({
    ...filter,
    [field]: { operator: filter?.[field]?.operator ?? 'within', window },
  });

export const setTaskFilterContent = (
  filter: TaskListFilter | undefined,
  content: string,
): TaskListFilter | undefined => normalizeTaskListFilter({ ...filter, content });

export const removeTaskFilterField = (
  filter: TaskListFilter | undefined,
  field: TaskListFilterField,
): TaskListFilter | undefined => {
  if (!filter) return undefined;
  const { [field]: _removed, ...rest } = filter;
  return normalizeTaskListFilter(rest);
};

/**
 * The part of a stored filter this page can show and edit. A condition on a
 * field the page does not offer (a member field once the page has no member
 * directory) would narrow the list with no chip to clear it, so it is ignored.
 */
export const pickOfferedTaskFilter = (
  filter: TaskListFilter | undefined,
  offeredFields: readonly TaskListFilterField[],
): TaskListFilter | undefined => {
  if (!filter) return undefined;
  const offered = new Set<TaskListFilterField>([...offeredFields, 'content']);
  return normalizeTaskListFilter(
    Object.fromEntries(
      Object.entries(filter).filter(([field]) => offered.has(field as TaskListFilterField)),
    ) as TaskListFilter,
  );
};

/** Chips list at most this many value labels inline; more collapse into a count. */
export const MAX_INLINE_TASK_FILTER_VALUES = 2;

/** Whether a chip shows its value labels inline rather than a count. */
export const showsTaskFilterValuesInline = (count: number): boolean =>
  count <= MAX_INLINE_TASK_FILTER_VALUES;

/** i18n key of a set chip's operator: "is" / "is not" read as "is any of" / "is none of" for several values. */
export const taskFilterSetOperatorKey = (
  operator: TaskListFilterSet<TaskFilterValue>['operator'],
  count: number,
) => {
  const many = count > 1;
  if (operator === 'isNot')
    return many ? 'taskList.filter.operator.isNoneOf' : 'taskList.filter.operator.isNot';
  return many ? 'taskList.filter.operator.isAnyOf' : 'taskList.filter.operator.is';
};
