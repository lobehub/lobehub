import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { runVerifyAfterEvidenceSubmission } from '@/server/services/verify/lifecycle';

interface OnEvidenceCompletePayload {
  parentOperationId: string;
  userId: string;
  workspaceId?: string;
}

export async function onEvidenceComplete(c: Context) {
  const body = (await c.req.json()) as OnEvidenceCompletePayload;
  if (!body.parentOperationId || !body.userId) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const db = await getServerDB();
  await runVerifyAfterEvidenceSubmission(
    db,
    body.userId,
    { deliverable: '', goal: '', operationId: body.parentOperationId },
    body.workspaceId,
  );
  return c.json({ success: true });
}
