import { Hono } from 'hono';
import { z } from 'zod';

import { DeveloperWebhookWorkflow } from '@/server/workflows/developerWebhook';

import { qstashAuth } from '../middlewares/qstashAuth';

const DeliverPayloadSchema = z.object({
  deliveryId: z.string().min(1),
  endpointId: z.string().min(1),
});

export const developerWebhookWorkflowApp = new Hono();

/** QStash callback: one delivery attempt. Always 200 once recorded; retries are re-published. */
developerWebhookWorkflowApp.post('/deliver', qstashAuth(), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid payload' }, 400);
  }
  const payload = DeliverPayloadSchema.safeParse(body);
  if (!payload.success) return c.json({ error: 'Invalid payload' }, 400);

  const result = await DeveloperWebhookWorkflow.runDeliver(payload.data);
  return c.json({ outcome: result.outcome });
});
