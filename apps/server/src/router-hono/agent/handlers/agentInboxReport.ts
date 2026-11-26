import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import { reportRunToOwnerChannel } from '@/server/services/agentIdentity/ownerChannel';

const payloadSchema = z.object({
  accountId: z.string().uuid(),
  operationId: z.string().min(1),
});

/**
 * Completion of a run an inbound mail woke: posts its answer to the owner's direct Channel.
 * The envelope carries identity only; the answer is read from storage, and a redelivery finds
 * the post already there.
 */
export async function agentInboxReport(c: Context): Promise<Response> {
  const body = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid inbox report' }, 400);

  try {
    const result = await reportRunToOwnerChannel(await getServerDB(), body.data);

    return c.json({ result, success: true });
  } catch (error) {
    console.error('[agentInboxReport] reporting run %s failed:', body.data.operationId, error);
    return c.json({ error: 'Inbox report failed' }, 500);
  }
}
