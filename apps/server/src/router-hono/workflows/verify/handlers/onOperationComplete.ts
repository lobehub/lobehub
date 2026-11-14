import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import type { VerifyOnOperationCompletePayload } from '@/server/services/verify';
import { runVerifyOnCompletionFromQueue } from '@/server/services/verify/lifecycle';

/**
 * QStash delivery of the completion-time verify gate (see
 * `scheduleVerifyOnCompletion`). A thrown gate surfaces as a 5xx so QStash
 * redelivers it.
 */
export async function onOperationComplete(c: Context) {
  const body = (await c.req.json()) as VerifyOnOperationCompletePayload;
  if (!body.operationId || !body.userId || typeof body.deliverable !== 'string') {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const db = await getServerDB();
  await runVerifyOnCompletionFromQueue(
    db,
    body.userId,
    { deliverable: body.deliverable, goal: body.goal ?? '', operationId: body.operationId },
    body.workspaceId,
  );
  return c.json({ success: true });
}
