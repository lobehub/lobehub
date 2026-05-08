import { isExecutionTime } from '@lobechat/utils/cronEval';
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
  pattern: string;
  taskId: string;
  taskIdentifier: string;
  timezone: string | null;
  userId: string;
}

/**
 * Cron-style central dispatcher. Registered as a QStash Schedule (e.g.
 * `*\/30 * * * *`) pointing at this endpoint. On each tick:
 *
 *   1. Loads all schedule-mode tasks in dispatchable status (`scheduled`/`backlog`).
 *   2. Filters by cron pattern + timezone + last-run dedup (`isExecutionTime`).
 *   3. Fan-outs one QStash message per due task to `/schedule-execute`.
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
      const matches = isExecutionTime({
        cronPattern: task.schedulePattern,
        currentTime: now,
        lastExecutedAt: task.lastHeartbeatAt ?? null,
        timezone: task.scheduleTimezone,
      });
      if (!matches) continue;
      due.push({
        pattern: task.schedulePattern,
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

    const dispatched = await fanout(due);

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

const fanout = async (due: DueTask[]): Promise<number> => {
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
