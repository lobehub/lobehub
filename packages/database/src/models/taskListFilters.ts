import { and, eq, gt, isNotNull, isNull, ne, notInArray, or, type SQL, sql } from 'drizzle-orm';

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
  /** Archived tasks are user-closed and hidden from every list unless asked for. */
  includeArchived?: boolean;
  /**
   * Tasks a Quick Note created (`context.source.type = 'quick_note'`) are listed in the Quick
   * Note sidebar, so task lists hide them unless asked for.
   */
  includeQuickNoteTasks?: boolean;
  parentTaskId?: string | null;
  projectId?: string;
  /** Only Tasks created by this Quick Note (its applied Proposals and Dives). */
  quickNoteId?: string;
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

/**
 * Rows not created by a Quick Note. The COALESCE keeps tasks whose context has no source (the
 * JSON path is NULL), which a bare `<>` would drop. It is spelled this way rather than
 * `IS DISTINCT FROM` because a null test on an extracted jsonb value crashes the pg_search
 * planner (see `jsonbNullTest.test.ts`).
 */
export const NOT_QUICK_NOTE_TASK = sql`COALESCE(${tasks.context} -> 'source' ->> 'type', '') <> 'quick_note'`;

/** Rows a Quick Note created, the complement of {@link NOT_QUICK_NOTE_TASK}. */
export const QUICK_NOTE_TASK = sql`(${tasks.context} -> 'source' ->> 'type') = 'quick_note'`;

/** The list filters shared by `list` and `groupList`; ownership is added by the model. */
export const buildTaskListFilters = ({
  assigneeAgentId,
  assigneeUserId,
  automated,
  closedAfter,
  createdByUserId,
  includeArchived,
  includeQuickNoteTasks,
  parentTaskId,
  quickNoteId,
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
  if (quickNoteId) {
    conditions.push(
      QUICK_NOTE_TASK,
      sql`(${tasks.context} -> 'source' ->> 'quickNoteId') = ${quickNoteId}`,
    );
  } else if (!includeQuickNoteTasks) {
    conditions.push(NOT_QUICK_NOTE_TASK);
  }
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

  return conditions;
};
