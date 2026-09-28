import type { Context } from 'hono';
import { z } from 'zod';

import { runDeferredReplay } from '@/server/services/bot/deferredReplay';

const payloadSchema = z.object({
  payload: z.object({
    applicationId: z.string().min(1),
    messengerInstallationKey: z.string().min(1).optional(),
    platform: z.string().min(1),
    platformThreadId: z.string().min(1),
  }),
});

/** QStash retries this isolated delivery without repeating the final bot reply. */
export async function botReplay(c: Context): Promise<Response> {
  const body = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid replay payload' }, 400);
  try {
    await runDeferredReplay(body.data.payload);
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Deferred replay failed' }, 500);
  }
}
