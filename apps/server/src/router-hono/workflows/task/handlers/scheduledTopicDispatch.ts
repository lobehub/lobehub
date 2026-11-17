import type { Context } from 'hono';

import {
  dispatchDueScheduledTopics,
  type ScheduledTopicDispatchPayload,
} from '@/server/services/aiAgent/pipeline/scheduledTopicDispatch';

export async function scheduledTopicDispatch(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as
      (ScheduledTopicDispatchPayload & { payload?: ScheduledTopicDispatchPayload }) | null;
    return c.json(await dispatchDueScheduledTopics(body?.payload ?? body ?? {}));
  } catch (error) {
    console.error('[task/scheduled-topic-dispatch] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
