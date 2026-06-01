import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { CompletionCallbackParams } from '../../../policies/completionPolicy';
import { type AgentSignalReceiptStore, persistAgentSignalReceipts } from '../../receiptService';
import { buildSelfIterationReceipts } from './buildSelfIterationReceipts';

export interface SelfIterationCompletionHandlerOptions {
  /** Receipt store override (defaults to the Redis store). Injected in tests. */
  receiptStore?: AgentSignalReceiptStore;
}

/**
 * Builds the `onSelfIterationCompleted` callback wired into the completion
 * policy. After a background self-iteration run finishes, it projects the run's
 * finalState tool outcomes (carried on the completion source payload) into
 * user-visible receipts and persists them — the execAgent replacement for the
 * old in-runtime receipt accumulator.
 *
 * Idempotent: `buildSelfIterationReceipts` derives deterministic receipt ids
 * from the source id + tool call ids, and the receipt store dedupes by id, so a
 * replayed completion event re-projects to the same receipts.
 */
export const createSelfIterationCompletionHandler =
  ({ receiptStore }: SelfIterationCompletionHandlerOptions = {}) =>
  async (params: CompletionCallbackParams): Promise<void> => {
    const { agentId, operationId, selfIteration, topicId } = params;
    if (!selfIteration) return;

    const { artifacts, marker, mutations, userId } = selfIteration;
    const sourceId = marker.sourceId ?? operationId;
    const resolvedTopicId = topicId ?? marker.topicId ?? sourceId;

    const receipts = buildSelfIterationReceipts({
      agentId,
      artifacts,
      createdAt: Date.now(),
      marker,
      mutations,
      operationId,
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
      topicId: resolvedTopicId,
      userId,
    });

    await persistAgentSignalReceipts(receipts, receiptStore ? { store: receiptStore } : {});
  };
