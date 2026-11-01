import debug from 'debug';
import type { Context } from 'hono';

import { runScheduleTick } from '@/server/services/taskRunner/scheduleTick';

const log = debug('lobe-server:workflows:task:schedule-execute');

export interface ScheduleExecutePayload {
  taskId: string;
  userId: string;
}

/**
 * Per-task executor — handler for QStash messages fanned out by
 * `/schedule-dispatch`. Mirrors `heartbeatTick.ts`: thin transport adapter,
 * delegates to `runScheduleTick` which owns DB-state re-validation.
 */
export async function scheduleExecute(c: Context) {
  try {
    const body = (await c.req.json()) as ScheduleExecutePayload;
    const { taskId, userId } = body;
    if (!taskId || !userId) {
      return c.json({ error: 'Missing required fields: taskId, userId' }, 400);
    }

    log('Received: taskId=%s userId=%s', taskId, userId);
    const outcome = await runScheduleTick(taskId, userId);
    return c.json({ success: true, ...outcome });
  } catch (error) {
    console.error('[task/schedule-execute] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
