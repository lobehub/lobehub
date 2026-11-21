import type { Context } from 'hono';

import {
  dispatchScheduledTasks,
  type ScheduleDispatchPayload,
} from '@/server/services/taskRunner/scheduleDispatch';

/**
 * QStash Schedule receiver for the central cron dispatcher. The route is
 * signature-verified by `qstashAuth`; the dispatch itself lives in
 * `dispatchScheduledTasks` so the built-in scheduler can run it without HTTP.
 */
export async function scheduleDispatch(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as ScheduleDispatchPayload | null;
    return c.json(await dispatchScheduledTasks(body ?? {}));
  } catch (error) {
    console.error('[task/schedule-dispatch] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
