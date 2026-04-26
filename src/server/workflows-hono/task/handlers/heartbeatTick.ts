import debug from 'debug';
import type { Context } from 'hono';

import { verifyQStashSignature } from '@/libs/qstash';
import { runHeartbeatTick } from '@/server/services/taskRunner/heartbeatTick';

const log = debug('lobe-server:workflows:task:heartbeat-tick');

export interface HeartbeatTickPayload {
  taskId: string;
  userId: string;
}

export async function heartbeatTick(c: Context) {
  try {
    const rawBody = await c.req.text();

    if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
      const ok = await verifyQStashSignature(c.req.raw, rawBody);
      if (!ok) {
        log('Rejected: invalid QStash signature');
        return c.json({ error: 'Invalid signature' }, 401);
      }
    }

    const body = JSON.parse(rawBody) as HeartbeatTickPayload;
    const { taskId, userId } = body;
    if (!taskId || !userId) {
      return c.json({ error: 'Missing required fields: taskId, userId' }, 400);
    }

    log('Received tick: taskId=%s userId=%s', taskId, userId);
    const outcome = await runHeartbeatTick(taskId, userId);
    return c.json({ success: true, ...outcome });
  } catch (error) {
    console.error('[task/heartbeat-tick] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
