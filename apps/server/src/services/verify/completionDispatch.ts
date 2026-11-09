import debug from 'debug';

import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { deliverWebhook } from '@/server/services/agentRuntime/hooks/httpWebhook';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { after } from '@/server/utils/scheduleAfterResponse';

import { runVerifyOnCompletion, type RunVerifyOnCompletionParams } from './lifecycle';

const log = debug('lobe-server:verify-completion-dispatch');

export const VERIFY_ON_OPERATION_COMPLETE_PATH = '/api/workflows/verify/on-operation-complete';

export interface VerifyOnOperationCompletePayload extends RunVerifyOnCompletionParams {
  userId: string;
  workspaceId?: string;
}

/**
 * Start the completion-time verify gate in its own invocation.
 *
 * It used to ride the completing request as post-response work. That request
 * can outlive its proxy (a heterogeneous `heteroFinish` past the 120 s edge
 * timeout) or its function, and the gate dies with it after it has already
 * claimed `verifying` — before any verifier exists. The producer then retries
 * the same completion, every retry meets the claim it cannot take over, and
 * the round is never judged. Published to QStash instead, the gate gets its own
 * function budget and redelivery, and the deduplication id collapses those
 * retried completions into one gate.
 *
 * Without a queue runtime (self-hosted local mode) there is no QStash, so the
 * gate stays post-response work. A failed publish falls back the same way:
 * judging late in-band beats not judging. Runs without a confirmed plan publish
 * nothing — the gate would only read the plan and return. Never throws.
 */
export const scheduleVerifyOnCompletion = async (
  db: LobeChatDatabase,
  userId: string,
  params: RunVerifyOnCompletionParams,
  workspaceId?: string,
): Promise<void> => {
  const runInBand = () => after(() => runVerifyOnCompletion(db, userId, params, workspaceId));

  if (!isQueueAgentRuntimeEnabled()) {
    runInBand();
    return;
  }

  try {
    const run = await new VerifyRunModel(db, userId, workspaceId).findByOperation(
      params.operationId,
    );
    if (!run?.plan?.length || !run.planConfirmedAt) return;
  } catch (error) {
    // Unknown is not "no plan": let the gate read it again in-band.
    log('plan lookup failed for op %s: %O', params.operationId, error);
    runInBand();
    return;
  }

  const payload: VerifyOnOperationCompletePayload = {
    ...params,
    userId,
    ...(workspaceId ? { workspaceId } : {}),
  };
  try {
    await deliverWebhook(
      { delivery: 'qstash', fallback: 'none', url: VERIFY_ON_OPERATION_COMPLETE_PATH },
      payload as unknown as Record<string, unknown>,
      { deduplicationId: `verify-completion:${params.operationId}` },
    );
  } catch (error) {
    console.error('[verify] publishing the completion gate failed, judging in-band: %O', error);
    log('publish failed for op %s, falling back to post-response work', params.operationId);
    runInBand();
  }
};
