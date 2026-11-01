import type { AgentOperationStatus, TaskItem, TaskRunTrigger } from '@lobechat/types';
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import type { AgentOperationError } from '../../schemas/agentOperations';
import { agentOperations } from '../../schemas/agentOperations';
import { tasks, taskTopics } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';

/**
 * Operation outcomes the orphaned-run reconciliation settles.
 *
 * An allow-list on purpose. `done` needs the success path's own inputs (the
 * run's last assistant content, the creator bridge) and `interrupted` belongs
 * to the interrupt path, so converging either from a sweep would mislabel the
 * outcome; and an operation status added later is skipped rather than guessed
 * at.
 */
const ORPHANED_RUN_OPERATION_STATUSES: AgentOperationStatus[] = ['abandoned', 'error'];

/** One `running` Task run whose operation has already ended — see the finder. */
export interface OrphanedRunningTopic {
  completionReason: string | null;
  /**
   * The failure the operation recorded, when it recorded one — the raw
   * `state.error`, so its message may be nested (`{ errorType, error: { message } }`).
   */
  operationError: AgentOperationError | null;
  operationId: string;
  operationStatus: AgentOperationStatus;
  taskId: string;
  taskIdentifier: string;
  topicId: string;
  trigger: TaskRunTrigger | null;
  userId: string;
  workspaceId: string | null;
}

// Tasks eligible for cron-based dispatch.
// Excludes terminal/paused/running — `paused` requires user attention,
// `running` is already in flight (and `runTask` would CONFLICT anyway).
export const getScheduledTasks = async (db: LobeChatDatabase): Promise<TaskItem[]> => {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.automationMode, 'schedule'),
        isNotNull(tasks.schedulePattern),
        notInArray(tasks.status, ['canceled', 'completed', 'failed', 'paused', 'running']),
      ),
    );
};

/**
 * Atomically move `context.scheduler.lastDispatchedOccurrenceAt` from
 * `expected` to `next`. Returns false when another writer changed it first.
 *
 * The schedule dispatcher reserves a cron occurrence this way before
 * publishing its execution, so a later tick inside the grace window (or an
 * overlapping dispatcher run) cannot publish the same occurrence again while
 * the first delivery is still queued.
 */
export const swapDispatchedScheduleOccurrence = async (
  db: LobeChatDatabase,
  taskId: string,
  expected: string | null,
  next: string | null,
): Promise<boolean> => {
  const current = sql`coalesce(${tasks.context}, '{}'::jsonb)`;
  const rows = await db
    .update(tasks)
    .set({
      context: sql`${current} || jsonb_build_object('scheduler', coalesce(${current} -> 'scheduler', '{}'::jsonb) || jsonb_build_object('lastDispatchedOccurrenceAt', ${next}::text))`,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        sql`coalesce(${current} -> 'scheduler' ->> 'lastDispatchedOccurrenceAt', '') = ${expected ?? ''}`,
      ),
    )
    .returning({ id: tasks.id });
  return rows.length > 0;
};

// Find stuck tasks (running but heartbeat timed out)
// Only checks tasks that have both lastHeartbeatAt and heartbeatTimeout set
export const findStuckTasks = async (db: LobeChatDatabase): Promise<TaskItem[]> => {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'running'),
        isNotNull(tasks.lastHeartbeatAt),
        isNotNull(tasks.heartbeatTimeout),
        sql`${tasks.lastHeartbeatAt} < now() - make_interval(secs => ${tasks.heartbeatTimeout})`,
      ),
    );
};

/**
 * Running Task runs whose operation has already ended.
 *
 * The terminal state of a run reaches `task_topics` / `tasks` through the
 * run's `onComplete` webhook, and that delivery is fire-and-forget: when it is
 * lost, the Task keeps a `running` run forever. Everything downstream then
 * believes a dead run is live — the Goal view reads its frozen heartbeat as
 * activity, and the coordinator parks on `waiting_external` instead of
 * recovering it. This finder is what lets a sweep settle those
 * rows without depending on the lost delivery.
 *
 * The grace window is what keeps the sweep from racing the normal path: the
 * operation is settled before its hook is dispatched, so only a run that has
 * been over for longer than any delivery lag is treated as orphaned.
 */
export const findOrphanedRunningTopics = async (
  db: LobeChatDatabase,
  options: { limit?: number; staleBefore: Date },
): Promise<OrphanedRunningTopic[]> => {
  const { limit = 200, staleBefore } = options;

  return (
    db
      .select({
        completionReason: agentOperations.completionReason,
        operationError: agentOperations.error,
        operationId: agentOperations.id,
        operationStatus: agentOperations.status,
        taskId: tasks.id,
        taskIdentifier: tasks.identifier,
        // Non-null by the guard below; the column is only nullable because a
        // legacy row could have been written without one.
        topicId: sql<string>`${taskTopics.topicId}`,
        trigger: taskTopics.trigger,
        userId: tasks.createdByUserId,
        workspaceId: tasks.workspaceId,
      })
      .from(taskTopics)
      // The run row names the operation it belongs to; a row without one cannot
      // be judged against an operation at all and is left alone.
      .innerJoin(agentOperations, eq(taskTopics.operationId, agentOperations.id))
      .innerJoin(tasks, eq(taskTopics.taskId, tasks.id))
      .where(
        and(
          eq(taskTopics.status, 'running'),
          // Only a Task that still believes it is running is repaired here.
          // One that left `running` was settled deliberately — by the user, or
          // by a cascade that already cancelled its run — and must not be
          // dragged back into a failure.
          eq(tasks.status, 'running'),
          isNotNull(taskTopics.operationId),
          // A run row with no topic cannot be driven through the lifecycle.
          isNotNull(taskTopics.topicId),
          // Sub-agent children extend their parent's turn and never own the
          // Task's run row, so only a top-level operation may settle it.
          isNull(agentOperations.parentOperationId),
          inArray(agentOperations.status, ORPHANED_RUN_OPERATION_STATUSES),
          sql`coalesce(${agentOperations.completedAt}, ${agentOperations.updatedAt}) < ${staleBefore}`,
        ),
      )
      .orderBy(sql`coalesce(${agentOperations.completedAt}, ${agentOperations.updatedAt})`)
      .limit(limit)
  );
};
