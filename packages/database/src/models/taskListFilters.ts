import {
  resolveTaskListFilterDateCutoff,
  TASK_LIST_FILTER_AGENT_CREATOR_PREFIX,
  TASK_LIST_FILTER_NONE,
  type TaskListFilter,
  type TaskListFilterDate,
  type TaskListFilterSet,
} from '@lobechat/types';
import {
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  notInArray,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { tasks } from '../schemas/task';

/**
 * A task the automation runtime would still act on.
 *
 * `automation_mode` alone does not mean "this fires". The tick services refuse
 * to run on exactly these grounds — `scheduleTick` skips a schedule with no
 * cron pattern, `heartbeatTick` skips a heartbeat with no positive interval,
 * and both skip a task that has reached a terminal status. A row that keeps its
 * mode after being completed, canceled or stripped of its pattern is a
 * leftover, not a schedule, and listing it as one lets dead entries crowd real
 * ones out of a bounded roll-up.
 *
 * Kept as one expression so the `automated` filter's two sides stay exact
 * complements and no row falls into neither bucket. `isTaskArchiveBlocked`
 * in `@lobechat/types` mirrors it in JS; keep the two in step.
 */
export const RUNNABLE_AUTOMATION = and(
  notInArray(tasks.status, ['canceled', 'completed', 'failed']),
  or(
    and(
      eq(tasks.automationMode, 'schedule'),
      isNotNull(tasks.schedulePattern),
      ne(tasks.schedulePattern, ''),
    ),
    and(eq(tasks.automationMode, 'heartbeat'), gt(tasks.heartbeatInterval, 0)),
  ),
)!;

/**
 * The `automated` filter's notion of live automation. An archived task never
 * fires (the runner refuses it), so it belongs with the ordinary tasks, where
 * "Show archived" can reach it, not in the scheduled roll-up.
 */
const LIVE_AUTOMATION = and(RUNNABLE_AUTOMATION, isNull(tasks.archivedAt))!;

/** The statuses `closedAfter` narrows, matching the list's `HIDDEN_WHEN_COMPLETED_STATUSES`. */
const CLOSED_TASK_STATUSES = ['canceled', 'completed'];

export interface TaskListFilterOptions {
  assigneeAgentId?: string;
  /** Only tasks assigned to this workspace member. */
  assigneeUserId?: string;
  automated?: boolean;
  /**
   * Leave out completed and canceled tasks closed before this time. A closed
   * task without `completedAt` (canceled ones) falls back to `updatedAt`;
   * unfinished tasks are never narrowed.
   */
  closedAfter?: Date;
  /** Only tasks created by this user. */
  createdByUserId?: string;
  /** The Tasks page filter (status, priority, agent, member, project, dates, content). */
  filter?: TaskListFilter;
  /** Archived tasks are user-closed and hidden from every list unless asked for. */
  includeArchived?: boolean;
  /** Clock the filter's relative date windows resolve against; tests pin it. */
  now?: number;
  parentTaskId?: string | null;
  projectId?: string;
  visibility?: 'private' | 'public';
}

export interface TaskListOptions extends TaskListFilterOptions {
  /**
   * Keyset cursor: only rows that sort strictly after this `(orderBy, seq)`
   * position in the list's newest-first order. Unlike `offset`, a cursor is
   * unaffected by rows inserted or deleted ahead of it, so a client walking
   * the whole list page by page never repeats or skips a row.
   */
  after?: { at: Date; seq: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  priorities?: number[];
  statuses?: string[];
}

/** The list filters shared by `list` and `groupList`; ownership is added by the model. */
export const buildTaskListFilters = ({
  assigneeAgentId,
  assigneeUserId,
  automated,
  closedAfter,
  createdByUserId,
  filter,
  includeArchived,
  now,
  parentTaskId,
  projectId,
  visibility,
}: TaskListFilterOptions): SQL[] => {
  const conditions: SQL[] = [];

  if (assigneeAgentId) conditions.push(eq(tasks.assigneeAgentId, assigneeAgentId));
  if (assigneeUserId) conditions.push(eq(tasks.assigneeUserId, assigneeUserId));
  if (createdByUserId) conditions.push(eq(tasks.createdByUserId, createdByUserId));
  if (automated === true) conditions.push(LIVE_AUTOMATION);
  // `IS NOT TRUE`, not `NOT (…)`: nullable automation fields make the
  // runnable expression NULL for manual tasks, and WHERE would drop them.
  if (automated === false) conditions.push(sql`${LIVE_AUTOMATION} IS NOT TRUE`);
  if (!includeArchived) conditions.push(isNull(tasks.archivedAt));
  if (closedAfter) {
    conditions.push(
      or(
        notInArray(tasks.status, CLOSED_TASK_STATUSES),
        sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt}) >= ${closedAfter.toISOString()}`,
      )!,
    );
  }
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  if (visibility) conditions.push(eq(tasks.visibility, visibility));

  if (parentTaskId === null) {
    conditions.push(isNull(tasks.parentTaskId));
  } else if (parentTaskId) {
    conditions.push(eq(tasks.parentTaskId, parentTaskId));
  }

  if (filter) conditions.push(...buildTaskFilterConditions(filter, now));

  return conditions;
};

/**
 * One value-set condition. `TASK_LIST_FILTER_NONE` stands for NULL, and
 * `isNot` keeps the NULL rows unless "none" itself is excluded — "agent is
 * not A" still lists the unassigned tasks, as `matchesTaskListFilter` does.
 */
const buildSetCondition = (
  column: PgColumn | SQL,
  set: TaskListFilterSet<number | string> | undefined,
): SQL | undefined => {
  if (!set || set.values.length === 0) return undefined;
  const includesNone = set.values.includes(TASK_LIST_FILTER_NONE);
  const values = set.values.filter((value) => value !== TASK_LIST_FILTER_NONE);
  // inArray overloads a column and an SQL expression separately; it rejects the union.
  const matchesValue =
    values.length === 0
      ? undefined
      : column instanceof SQL
        ? inArray(column, values)
        : inArray(column, values);
  const matchesNone = includesNone ? isNull(column) : undefined;

  if (set.operator === 'isNot') {
    // NOT IN is NULL for a NULL column, so the NULL side is decided explicitly.
    const notValue = matchesValue ? or(isNull(column), not(matchesValue)) : undefined;
    return includesNone ? and(isNotNull(column), ...(notValue ? [notValue] : [])) : notValue;
  }
  return or(...[matchesValue, matchesNone].filter((c): c is SQL => !!c));
};

/**
 * Member values match `created_by_user_id`, `agent:<id>` values match
 * `created_by_agent_id`; a task matches when either side does, so a member
 * still finds the tasks their agents created. Mirrors `matchesTaskListFilter`.
 */
const buildCreatorCondition = (set: TaskListFilterSet<string> | undefined): SQL | undefined => {
  if (!set || set.values.length === 0) return undefined;
  const userIds = set.values.filter(
    (value) => !value.startsWith(TASK_LIST_FILTER_AGENT_CREATOR_PREFIX),
  );
  const agentIds = set.values
    .filter((value) => value.startsWith(TASK_LIST_FILTER_AGENT_CREATOR_PREFIX))
    .map((value) => value.slice(TASK_LIST_FILTER_AGENT_CREATOR_PREFIX.length));
  const matches = or(
    ...[
      userIds.length > 0 ? inArray(tasks.createdByUserId, userIds) : undefined,
      agentIds.length > 0 ? inArray(tasks.createdByAgentId, agentIds) : undefined,
    ].filter((condition): condition is SQL => !!condition),
  )!;
  // `created_by_agent_id` is NULL on member-made tasks; coalesce keeps NOT from
  // turning that NULL into "unknown" and dropping the row.
  return set.operator === 'isNot' ? not(sql`coalesce(${matches}, false)`) : matches;
};

/** A NULL timestamp (an unfinished task's `completedAt`) matches neither side. */
const buildDateCondition = (
  column: PgColumn,
  date: TaskListFilterDate | undefined,
  now?: number,
): SQL | undefined => {
  if (!date) return undefined;
  const cutoff = resolveTaskListFilterDateCutoff(date.window, now);
  return date.operator === 'before' ? lt(column, cutoff) : gte(column, cutoff);
};

/** `%`, `_` and the escape character itself are literal in a content search. */
const escapeLikePattern = (value: string) => value.replaceAll(/[%\\_]/g, (char) => `\\${char}`);

export const buildTaskFilterConditions = (filter: TaskListFilter, now?: number): SQL[] => {
  const content = filter.content?.trim();
  const pattern = content ? `%${escapeLikePattern(content)}%` : undefined;

  return [
    buildSetCondition(tasks.status, filter.status),
    // A missing priority is "no priority" (0), the same bucket the UI shows it in.
    buildSetCondition(sql`coalesce(${tasks.priority}, 0)`, filter.priority),
    buildSetCondition(tasks.assigneeAgentId, filter.agent),
    buildSetCondition(tasks.assigneeUserId, filter.assignee),
    buildCreatorCondition(filter.creator),
    buildSetCondition(tasks.projectId, filter.project),
    buildDateCondition(tasks.createdAt, filter.createdAt, now),
    buildDateCondition(tasks.updatedAt, filter.updatedAt, now),
    buildDateCondition(tasks.completedAt, filter.completedAt, now),
    pattern
      ? or(
          ilike(tasks.name, pattern),
          ilike(tasks.identifier, pattern),
          ilike(tasks.description, pattern),
          ilike(tasks.instruction, pattern),
        )
      : undefined,
  ].filter((condition): condition is SQL => !!condition);
};
