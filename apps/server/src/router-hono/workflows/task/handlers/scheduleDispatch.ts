import { findDueOccurrence } from '@lobechat/utils/cronEval';
import debug from 'debug';
import type { Context } from 'hono';

import { TaskModel } from '@/database/models/task';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';
import { runScheduleTick } from '@/server/services/taskRunner/scheduleTick';

const log = debug('lobe-server:workflows:task:schedule-dispatch');

const SCHEDULE_EXECUTE_PATH = '/api/workflows/task/schedule-execute';

export interface ScheduleDispatchPayload {
  /** When true, only return what would be dispatched without firing executes. */
  dryRun?: boolean;
}

interface DueTask {
  /** The cron occurrence (ISO) this dispatch fires. */
  occurrence: string;
  pattern: string;
  /** `context.scheduler.lastDispatchedOccurrenceAt` as read on this tick. */
  previousOccurrence: string | null;
  taskId: string;
  taskIdentifier: string;
  timezone: string | null;
  userId: string;
}

/**
 * Cron-style central dispatcher. Registered as a QStash Schedule
 * (`*\/10 * * * *`, see `scripts/serverLauncher/startServer.js`) pointing at
 * this endpoint. On each tick:
 *
 *   1. Loads all schedule-mode tasks in dispatchable status (`scheduled`/`backlog`).
 *   2. Filters by cron pattern + timezone + last-run dedup (`findDueOccurrence`).
 *   3. Reserves each due occurrence on the task row, then fans out one QStash
 *      message per reserved task to `/schedule-execute`.
 *
 * No per-user authentication: this is a global sweep. Signature verification is
 * handled by the `qstashAuth` middleware on the route.
 */
export async function scheduleDispatch(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as ScheduleDispatchPayload;
    const { dryRun = false } = body ?? {};

    const db = await getServerDB();
    const tasks = await TaskModel.getScheduledTasks(db);

    const now = new Date();
    const due: DueTask[] = [];
    for (const task of tasks) {
      if (!task.schedulePattern) continue;
      const scheduler = (
        task.context as {
          scheduler?: { lastDispatchedOccurrenceAt?: string; scheduleStartedAt?: string };
        } | null
      )?.scheduler;
      // Stamped when the user (re)starts the schedule; an occurrence before it
      // must not fire, or arming just after a slot would replay that slot.
      const scheduleStartedAt = scheduler?.scheduleStartedAt;
      // `lastHeartbeatAt` only moves once the run starts, and the grace window
      // spans several ticks, so an occurrence whose delivery is still queued
      // is covered by the reservation made when it was dispatched.
      const previousOccurrence = scheduler?.lastDispatchedOccurrenceAt ?? null;
      const coveredUntil = latest(task.lastHeartbeatAt, previousOccurrence);
      const occurrence = findDueOccurrence({
        armedAt: scheduleStartedAt ? new Date(scheduleStartedAt) : null,
        cronPattern: task.schedulePattern,
        currentTime: now,
        lastExecutedAt: coveredUntil,
        timezone: task.scheduleTimezone,
      });
      if (!occurrence) continue;
      due.push({
        occurrence: occurrence.toISOString(),
        pattern: task.schedulePattern,
        previousOccurrence,
        taskId: task.id,
        taskIdentifier: task.identifier,
        timezone: task.scheduleTimezone,
        userId: task.createdByUserId,
      });
    }

    log(
      'scan: total=%d due=%d skipped=%d dryRun=%s',
      tasks.length,
      due.length,
      tasks.length - due.length,
      dryRun,
    );

    if (dryRun || due.length === 0) {
      return c.json({
        dispatched: 0,
        dryRun,
        due: due.length,
        skipped: tasks.length - due.length,
        success: true,
        total: tasks.length,
      });
    }

    const reserved = await reserve(db, due);
    const dispatched = await fanout(db, reserved);

    return c.json({
      dispatched,
      due: due.length,
      skipped: tasks.length - due.length,
      success: true,
      total: tasks.length,
    });
  } catch (error) {
    console.error('[task/schedule-dispatch] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

const latest = (...dates: (Date | string | null | undefined)[]): Date | null => {
  let result: Date | null = null;
  for (const value of dates) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!result || date > result) result = date;
  }
  return result;
};

type ServerDB = Awaited<ReturnType<typeof getServerDB>>;

/**
 * Reserve each due occurrence with a compare-and-set on the task row. Only the
 * dispatcher that wins the swap publishes it, so an occurrence still queued
 * from an earlier tick (or claimed by an overlapping dispatcher run) is never
 * published twice.
 */
const reserve = async (db: ServerDB, due: DueTask[]): Promise<DueTask[]> => {
  const results = await Promise.allSettled(
    due.map((d) =>
      TaskModel.swapDispatchedScheduleOccurrence(db, d.taskId, d.previousOccurrence, d.occurrence),
    ),
  );
  const reserved: DueTask[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled' && r.value) {
      reserved.push(due[i]);
    } else if (r.status === 'fulfilled') {
      log('skip task=%s occurrence=%s reason=already-reserved', due[i].taskId, due[i].occurrence);
    } else {
      console.error(
        '[task/schedule-dispatch] failed to reserve task=%s occurrence=%s: %O',
        due[i].taskId,
        due[i].occurrence,
        r.reason,
      );
    }
  }
  return reserved;
};

/** Hand a reservation back when its publish failed, so the next tick retries it. */
const release = async (db: ServerDB, d: DueTask) => {
  try {
    await TaskModel.swapDispatchedScheduleOccurrence(
      db,
      d.taskId,
      d.occurrence,
      d.previousOccurrence,
    );
  } catch (error) {
    console.error(
      '[task/schedule-dispatch] failed to release task=%s occurrence=%s: %O',
      d.taskId,
      d.occurrence,
      error,
    );
  }
};

const fanout = async (db: ServerDB, due: DueTask[]): Promise<number> => {
  // In queue mode, hand off via QStash so each task gets its own retry budget
  // and runs in an isolated handler invocation. Locally, just run inline so
  // dev / electron can exercise the path without QStash.
  if (appEnv.enableQueueAgentRuntime) {
    if (!process.env.APP_URL) {
      throw new Error('APP_URL is required to fan out scheduled task executions via QStash');
    }
    const url = `${process.env.APP_URL.replace(/\/$/, '')}${SCHEDULE_EXECUTE_PATH}`;

    const results = await Promise.allSettled(
      due.map((d) =>
        qstashClient.publishJSON({
          body: { taskId: d.taskId, userId: d.userId },
          url,
        }),
      ),
    );

    let dispatched = 0;
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') {
        dispatched += 1;
      } else {
        console.error(
          '[task/schedule-dispatch] failed to publish task=%s identifier=%s: %O',
          due[i].taskId,
          due[i].taskIdentifier,
          r.reason,
        );
        await release(db, due[i]);
      }
    }
    return dispatched;
  }

  // Local / dev: invoke runScheduleTick directly. Errors are logged but don't
  // fail the dispatch — one bad task shouldn't block the rest.
  const results = await Promise.allSettled(due.map((d) => runScheduleTick(d.taskId, d.userId)));
  let dispatched = 0;
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      dispatched += 1;
    } else {
      console.error(
        '[task/schedule-dispatch] inline tick failed task=%s: %O',
        due[i].taskId,
        r.reason,
      );
    }
  }
  return dispatched;
};
