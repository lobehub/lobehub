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

export interface TaskListFilterOptions {
  assigneeAgentId?: string;
  /** Only tasks assigned to this workspace member. */
  assigneeUserId?: string;
  automated?: boolean;
  /** Only tasks created by this user. */
  createdByUserId?: string;
  /** Archived tasks are user-closed and hidden from every list unless asked for. */
  includeArchived?: boolean;
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
  createdByUserId,
  includeArchived,
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
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  if (visibility) conditions.push(eq(tasks.visibility, visibility));

  if (parentTaskId === null) {
    conditions.push(isNull(tasks.parentTaskId));
  } else if (parentTaskId) {
    conditions.push(eq(tasks.parentTaskId, parentTaskId));
  }

  return conditions;
};
