import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { receiveInboundWebhook } from '@/server/services/inboundWebhook/receiver';
import { scheduleInboundWebhookSweep } from '@/server/services/inboundWebhook/sweep';

export const inboundWebhookBodyLimit = bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) => c.json({ error: 'Payload too large' }, 413),
});
export async function inboundWebhook(c: Context) {
  const id = c.req.param('id');
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'Webhook is gone' }, 410);
  try {
    const result = await receiveInboundWebhook(await getServerDB(), {
      body: await c.req.text(),
      headers: c.req.raw.headers,
      id: id!,
    });
    scheduleInboundWebhookSweep();
    return c.json(result.body, result.status);
  } catch {
    console.error('[inboundWebhook:route] Delivery failed');
    return c.json({ error: 'Delivery temporarily unavailable' }, 503);
  }
}
