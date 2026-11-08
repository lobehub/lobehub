import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { runDigestFlush } from '@/server/services/agentIdentity/wake/digest';

const payloadSchema = z.object({
  payload: z.object({
    accountId: z.string().uuid(),
    at: z.number(),
  }),
});

/**
 * The mail digest's delayed trigger: runs what one account held back since the last digest.
 * QStash can deliver it more than once; the second delivery finds the items already claimed.
 */
export async function agentAccountDigestFlush(c: Context): Promise<Response> {
  const body = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid digest flush payload' }, 400);

  try {
    const result = await runDigestFlush(await getServerDB(), body.data.payload);

    return c.json({ result, success: true });
  } catch (error) {
    console.error(
      '[agentAccountDigestFlush] flush failed for %s:',
      body.data.payload.accountId,
      error,
    );
    // A 5xx makes QStash retry the flush; the items it claimed were given back.
    return c.json({ error: 'Digest flush failed' }, 500);
  }
}
