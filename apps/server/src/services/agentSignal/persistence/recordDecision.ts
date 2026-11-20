import type {
  SignalDecisionMetadata,
  SignalDecisionOutcome,
  SignalDecisionVerdict,
  SignalMetadata,
} from '@lobechat/types';
import debug from 'debug';

import { SignalModel } from '@/database/models/signal';
import { SignalDecisionModel } from '@/database/models/signalDecision';
import type { LobeChatDatabase } from '@/database/type';

import { resolveSignalPersistence, shouldPersistSignal } from './policy';

const log = debug('lobe-server:agent-signal:persistence');

export interface RecordSignalDecisionParams {
  /** The agent that made the decision; part of the idempotency key, so it is required. */
  agentId: string;
  /** The decision itself. */
  decision: {
    finalReason?: string;
    llmTracingIds?: string[];
    /** The context the decision was made in; never message content. */
    metadata?: SignalDecisionMetadata;
    operationId?: string;
    outcome: SignalDecisionOutcome;
    pipelineVersion: string;
    toTag?: string;
    topicId?: string;
    verdicts?: SignalDecisionVerdict[];
  };
  /** Channel the signal arrived on. */
  scopeKey: string;
  /** The signal the decision is about. `sourceType` selects its persistence policy. */
  signal: {
    externalId: string;
    /** How the event reached us and where it was addressed; survives the payload purge. */
    metadata?: SignalMetadata;
    occurredAt?: Date;
    /** The event as the source delivered it; blanked by the retention sweep. */
    payload?: Record<string, unknown>;
    /** `signals.source`, e.g. `bot:discord`. */
    source: string;
    /** AgentSignal source type or Oracle name; looked up in the persistence registry. */
    sourceType: string;
    /** `signals.type`. */
    type: string;
  };
  userId: string;
  workspaceId?: string;
}

/**
 * Stores one signal and the decision made about it, as the signal's persistence policy allows.
 *
 * Use when:
 * - A pipeline has just decided what to do with a signal and the outcome should be auditable
 *
 * Returns:
 * - `{ persisted: false }` when the policy is `never` (nothing is written)
 * - `{ persisted: true, decisionId, signalId }` otherwise; redelivery returns the stored ids
 *
 * Throws on database errors; callers on a hot path wrap it so recording never changes behavior.
 */
export const recordSignalDecision = async (
  db: LobeChatDatabase,
  params: RecordSignalDecisionParams,
): Promise<{ decisionId: string; persisted: true; signalId: string } | { persisted: false }> => {
  const policy = resolveSignalPersistence(params.signal.sourceType);

  if (!shouldPersistSignal(policy, { hasDecision: true })) {
    log('not persisted: sourceType=%s policy=%s', params.signal.sourceType, policy);
    return { persisted: false };
  }

  const signal = await new SignalModel(db, params.userId, params.workspaceId).record({
    agentId: params.agentId,
    externalId: params.signal.externalId,
    metadata: params.signal.metadata,
    occurredAt: params.signal.occurredAt,
    payload: params.signal.payload,
    scopeKey: params.scopeKey,
    source: params.signal.source,
    type: params.signal.type,
  });
  if (!signal) return { persisted: false };

  const { agentId, scopeKey } = params;
  const decision = await new SignalDecisionModel(db, params.userId, params.workspaceId).record({
    agentId,
    finalReason: params.decision.finalReason,
    llmTracingIds: params.decision.llmTracingIds,
    metadata: params.decision.metadata,
    operationId: params.decision.operationId,
    outcome: params.decision.outcome,
    pipelineVersion: params.decision.pipelineVersion,
    scopeKey,
    signalId: signal.id,
    toTag: params.decision.toTag,
    topicId: params.decision.topicId,
    verdicts: params.decision.verdicts,
  });
  if (!decision) return { persisted: false };

  return { decisionId: decision.id, persisted: true, signalId: signal.id };
};
