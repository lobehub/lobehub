import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';
import { settleVerifierCheckFromTerminal } from '@/server/services/verify/verifierTerminal';

const log = debug('lobe-server:workflows:verify:on-verifier-complete');

export interface OnVerifierCompletePayload {
  checkItemId: string;
  errorMessage?: string;
  hookId?: string;
  hookType?: string;
  operationId: string;
  parentOperationId: string;
  reason?: string;
  userId: string;
  workspaceId?: string;
}

export async function onVerifierComplete(c: Context) {
  try {
    const body = (await c.req.json()) as OnVerifierCompletePayload;
    const {
      checkItemId,
      errorMessage,
      operationId,
      parentOperationId,
      reason,
      userId,
      workspaceId,
    } = body;

    if (!checkItemId || !operationId || !parentOperationId || !userId) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    log(
      'Received: parent=%s verifier=%s check=%s reason=%s',
      parentOperationId,
      operationId,
      checkItemId,
      reason,
    );

    const db = await getServerDB();
    await settleVerifierCheckFromTerminal(
      db,
      userId,
      {
        checkItemId,
        errorMessage,
        parentOperationId,
        reason,
        verifierOperationId: operationId,
      },
      workspaceId,
    );

    return c.json({ success: true });
  } catch (error) {
    console.error('[verify/on-verifier-complete] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
