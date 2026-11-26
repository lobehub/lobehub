import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { reportWebhookRunToChannel } from '@/server/services/inboundWebhook/channelDelivery';

const payloadSchema = z.object({
  operationId: z.string().min(1),
  webhookId: z.string().uuid(),
});

/**
 * Completion of a run a webhook woke, for a webhook that delivers to a Channel: posts its answer
 * there. The envelope carries identity only; the answer is read from storage, and a redelivery
 * finds the post already there.
 */
export async function inboundWebhookReport(c: Context): Promise<Response> {
  const body = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid webhook report' }, 400);

  try {
    const result = await reportWebhookRunToChannel(await getServerDB(), body.data);
    return c.json({ result, success: true });
  } catch (error) {
    console.error('[inboundWebhookReport] reporting run %s failed:', body.data.operationId, error);
    return c.json({ error: 'Webhook report failed' }, 500);
  }
}
