import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { runVerifyAfterEvidenceSubmission } from '@/server/services/verify/lifecycle';

interface OnEvidenceCompletePayload {
  deliverable: string;
  goal: string;
  parentOperationId: string;
  userId: string;
  workspaceId?: string;
}

export async function onEvidenceComplete(c: Context) {
  const body = (await c.req.json()) as OnEvidenceCompletePayload;
  if (!body.parentOperationId || !body.userId || typeof body.deliverable !== 'string') {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const db = await getServerDB();
  await runVerifyAfterEvidenceSubmission(
    db,
    body.userId,
    { deliverable: body.deliverable, goal: body.goal ?? '', operationId: body.parentOperationId },
    body.workspaceId,
  );
  return c.json({ success: true });
}
