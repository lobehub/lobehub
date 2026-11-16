import { Hono } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { sweepInboundWebhooks } from '@/server/services/inboundWebhook/sweep';
import { wakeInboundWebhook } from '@/server/services/inboundWebhook/waker';

import { qstashAuth } from '../middlewares/qstashAuth';

export const inboundWebhookWorkflowApp = new Hono();
inboundWebhookWorkflowApp.post('/sweep', qstashAuth(), async (c) =>
  c.json(await sweepInboundWebhooks(await getServerDB())),
);
inboundWebhookWorkflowApp.post('/wake', qstashAuth(), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid payload' }, 400);
  }
  const payload = z.object({ id: z.uuid() }).safeParse(body);
  if (!payload.success) return c.json({ error: 'Invalid payload' }, 400);
  const result = await wakeInboundWebhook(await getServerDB(), payload.data.id);
  // QStash backs off and retries busy topics. Persistent signals also have the sweep as a backstop.
  return c.json(result, result.outcome === 'deferred' ? 503 : 200);
});
