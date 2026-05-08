import {
  AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
  type AgentSignalFeedbackDomainTarget,
  type AgentSignalFeedbackSatisfactionResult,
  type AgentSignalPolicySignalVariant,
  type SignalFeedbackDomainMemory,
  type SignalFeedbackDomainNone,
  type SignalFeedbackDomainPrompt,
  type SignalFeedbackDomainSkill,
} from '../policies/types';
import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureRecord,
  ProcedureAccumulatorScoreResult,
} from '../procedure';
import { createProcedureRecord } from '../procedure';
import type { RuntimeProcessorContext } from '../runtime/context';
import type { ProcedureMarkerSuppressInput } from '../services/types';
import { continueWith, noopResult, stop, transitionToSignals } from './runtimeResults';
import type { SignalProcessorResult } from './types';

/**
 * Minimal procedure state surface consumed by procedure processors.
 */
export interface ProcedureProcessorStateService {
  /** Procedure accumulator operations used by weak-signal accumulation. */
  accumulators?: {
    /** Appends one record and returns a score result when the bucket crosses scoring gates. */
    appendAndScore: (
      record: AgentSignalProcedureRecord,
    ) => Promise<ProcedureAccumulatorScoreResult | undefined>;
  };
  /** Procedure marker operations used by suppression reads and optional marker writes. */
  markers?: {
    /** Checks whether an active handled marker suppresses the current procedure candidate. */
    shouldSuppress: (input: ProcedureMarkerSuppressInput) => Promise<boolean>;
    /** Writes one procedure marker when callers need to persist transition state. */
    write?: (marker: AgentSignalProcedureMarker) => Promise<void>;
  };
  /** Scope-local procedure record operations. */
  records?: {
    /** Writes one compact procedure record field. */
    write: (record: AgentSignalProcedureRecord) => Promise<void>;
  };
}

/**
 * Procedure state dependencies used by procedure processors.
 */
export interface ProcedureProcessorServices {
  /** Optional procedure-state facade for marker reads and record writes. */
  procedureState?: ProcedureProcessorStateService;
}

/**
 * Options for suppressing already-handled procedure candidates.
 */
export interface SuppressHandledOptions {
  /** Optional transition returned when a handled procedure marker suppresses this signal. */
  onSuppress?: () => SignalProcessorResult;
}

/**
 * Options for accumulating weak procedure signals.
 */
export interface AccumulateSignalOptions {
  /** Domain that is allowed to accumulate through this processor. */
  domain: 'skill';
  /** Cheap deterministic score delta written to the candidate record. */
  scoreDelta: number;
}

/**
 * Options for deciding whether an accumulated score should advance.
 */
export interface ScoreIncreaseOptions {
  /** Minimum number of records required before a score can advance. */
  minRecords: number;
  /** Minimum aggregate score required before a score can advance. */
  threshold: number;
}

/**
 * Feedback domain signal variants accepted by procedure processors.
 */
export type FeedbackDomainSignal =
  | SignalFeedbackDomainMemory
  | SignalFeedbackDomainNone
  | SignalFeedbackDomainPrompt
  | SignalFeedbackDomainSkill;

/**
 * Skill-domain feedback signal after callers have narrowed to satisfied feedback.
 */
export type SatisfiedSkillFeedbackDomainSignal = SignalFeedbackDomainSkill & {
  payload: SignalFeedbackDomainSkill['payload'] & {
    satisfactionResult: 'satisfied';
    target: 'skill';
  };
};

/**
 * Synthetic procedure bucket score signal emitted by procedure processors.
 */
export type ProcedureBucketScoredSignal = AgentSignalPolicySignalVariant<
  typeof AGENT_SIGNAL_POLICY_SIGNAL_TYPES.procedureBucketScored
>;

const toDomainKey = (target: AgentSignalFeedbackDomainTarget) => {
  if (target === 'memory') return 'memory:user-preference';
  if (target === 'skill') return 'skill';
  return target;
};

const toPlannerIntentClass = (
  result?: AgentSignalFeedbackSatisfactionResult,
): 'implicit_positive' | 'unknown' => {
  return result === 'satisfied' ? 'implicit_positive' : 'unknown';
};

const toPlannerIntentClassCandidates = (
  target: AgentSignalFeedbackDomainTarget,
  result?: AgentSignalFeedbackSatisfactionResult,
) => {
  const primary = toPlannerIntentClass(result);
  if (target === 'memory') return [primary, 'explicit_persistence', 'unknown'];
  if (target === 'skill') return [primary, 'tool_command', 'explicit_persistence', 'unknown'];
  return [primary, 'unknown'];
};

/**
 * Stops procedure work when an active handled marker already covers the signal.
 *
 * Use when:
 * - Feedback-domain signals need to avoid replaying direct tool outcomes
 * - Procedure marker state is the source of truth for planner suppression
 *
 * Expects:
 * - `signal.payload` contains a feedback domain payload with `messageId` and `target`
 * - `context.scopeKey` identifies the shared runtime scope
 *
 * Returns:
 * - A stop result when marker state suppresses the signal, otherwise the original signal
 *
 * Triggering workflow:
 *
 * `signal.feedback.domain.*`
 *   -> {@link suppressHandled}
 *     -> {@link ProcedureStateService.markers.shouldSuppress}
 *
 * Upstream:
 * - `signal.feedback.domain.*`
 *
 * Downstream:
 * - {@link ProcedureStateService.markers.shouldSuppress}
 */
export const suppressHandled = async (
  signal: FeedbackDomainSignal,
  context: RuntimeProcessorContext,
  services: ProcedureProcessorServices,
  options: SuppressHandledOptions = {},
) => {
  const { payload } = signal;
  const suppressed = await services.procedureState?.markers?.shouldSuppress({
    domainKey: toDomainKey(payload.target),
    intentClass: toPlannerIntentClass(payload.satisfactionResult),
    intentClassCandidates: toPlannerIntentClassCandidates(
      payload.target,
      payload.satisfactionResult,
    ),
    procedureKey: `message:${payload.messageId}`,
    scopeKey: context.scopeKey,
  });

  if (suppressed) {
    return (
      options.onSuppress?.() ??
      stop(
        'suppressed by handled procedure marker',
        noopResult('suppressed by handled procedure marker'),
      )
    );
  }

  return continueWith('no handled marker matched', signal);
};

/**
 * Writes and scores one satisfied skill procedure candidate.
 *
 * Use when:
 * - Weak positive skill feedback should accumulate before action planning
 * - A procedure-state service is available for record and accumulator persistence
 *
 * Expects:
 * - `options.domain` is `skill`
 * - `signal.payload.target` is `skill` and `satisfactionResult` is `satisfied`
 *
 * Returns:
 * - A continue result with the written record and optional score result
 *
 * Triggering workflow:
 *
 * `signal.feedback.domain.skill`
 *   -> {@link accumulateSignal}
 *     -> {@link ProcedureStateService.records.write}
 *       -> {@link ProcedureStateService.accumulators.appendAndScore}
 *
 * Upstream:
 * - `signal.feedback.domain.skill`
 *
 * Downstream:
 * - {@link ProcedureStateService.records.write}
 * - {@link ProcedureStateService.accumulators.appendAndScore}
 */
export const accumulateSignal = async (
  signal: SatisfiedSkillFeedbackDomainSignal,
  context: RuntimeProcessorContext,
  services: ProcedureProcessorServices,
  options: AccumulateSignalOptions,
) => {
  const { payload } = signal;

  if (!services.procedureState?.records || !services.procedureState.accumulators) {
    return stop('procedure state unavailable');
  }

  const record = createProcedureRecord({
    accumulatorRole: 'candidate',
    cheapScoreDelta: options.scoreDelta,
    createdAt: context.now(),
    domainKey: 'skill',
    id: `procedure-record:${signal.signalId}:skill-candidate`,
    intentClass: toPlannerIntentClass(payload.satisfactionResult),
    refs: {
      signalIds: [signal.signalId],
      sourceIds: signal.source ? [signal.source.sourceId] : undefined,
    },
    scopeKey: context.scopeKey,
    status: 'observed',
    summary: payload.reason ?? payload.message,
  });

  await services.procedureState.records.write(record);
  const scored = await services.procedureState.accumulators.appendAndScore(record);

  return continueWith('accumulated skill candidate', { record, scored });
};

/**
 * Checks whether an accumulator score crosses local promotion gates.
 *
 * Use when:
 * - A scored procedure bucket should only dispatch after enough evidence
 * - Deterministic score thresholds protect downstream handlers from weak signals
 *
 * Expects:
 * - `scored` is either undefined or a full procedure accumulator score result
 * - `options.minRecords` and `options.threshold` are already domain-specific
 *
 * Returns:
 * - A continue result with the score when gates pass, otherwise a no-op stop
 */
export const scoreIncrease = (
  scored: ProcedureAccumulatorScoreResult | undefined,
  options: ScoreIncreaseOptions,
) => {
  if (!scored) return stop('score gates not met');
  if (scored.bucket.recordIds.length < options.minRecords) return stop('score gates not met');
  if (scored.score.aggregateScore < options.threshold) return stop('score gates not met');

  return continueWith('score gates met', scored);
};

/**
 * Dispatches a synthetic score signal for a suppressed procedure candidate.
 *
 * Use when:
 * - A handled marker suppresses action planning
 * - Downstream observers still need a procedure score signal for continuity
 *
 * Expects:
 * - `signal.payload.target` contains the suppressed feedback domain
 * - `signal.chain.rootSourceId` is present for trace continuity
 *
 * Returns:
 * - A transition result that dispatches one suppressed procedure score signal
 *
 * Triggering workflow:
 *
 * {@link suppressHandled}
 *   -> {@link transitionSuppressedProcedure}
 *     -> `signal.procedure.bucket.scored`
 *
 * Upstream:
 * - {@link suppressHandled}
 *
 * Downstream:
 * - `signal.procedure.bucket.scored`
 */
export const transitionSuppressedProcedure = (
  signal: FeedbackDomainSignal,
  context: RuntimeProcessorContext,
) => {
  const { payload } = signal;
  const domain = toDomainKey(payload.target);
  const suppressedSignal: ProcedureBucketScoredSignal = {
    chain: {
      chainId: signal.chain.chainId,
      parentNodeId: signal.signalId,
      parentSignalId: signal.signalId,
      rootSourceId: signal.chain.rootSourceId,
    },
    payload: {
      aggregateScore: 0,
      bucketKey: `${context.scopeKey}:${domain}`,
      confidence: 1,
      domain,
      itemScores: [],
      recordIds: [],
      suggestedActions: ['suppressed'],
    },
    signalId: `${signal.signalId}:signal:procedure-suppressed`,
    signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.procedureBucketScored,
    source: signal.source,
    timestamp: context.now(),
  };

  return transitionToSignals(suppressedSignal, {
    reason: 'dispatch suppressed procedure score signal',
  });
};

/**
 * Dispatches a synthetic score signal for an accumulated procedure bucket.
 *
 * Use when:
 * - A scored accumulator bucket passes promotion gates
 * - Downstream handlers need the compact procedure score payload
 *
 * Expects:
 * - `scored` contains the bucket and batch score returned by procedure state
 * - `signal.chain.rootSourceId` is present for trace continuity
 *
 * Returns:
 * - A transition result that dispatches one accumulated procedure score signal
 *
 * Triggering workflow:
 *
 * {@link scoreIncrease}
 *   -> {@link transitionScoredProcedure}
 *     -> `signal.procedure.bucket.scored`
 *
 * Upstream:
 * - {@link scoreIncrease}
 *
 * Downstream:
 * - `signal.procedure.bucket.scored`
 */
export const transitionScoredProcedure = (
  signal: SatisfiedSkillFeedbackDomainSignal,
  scored: ProcedureAccumulatorScoreResult,
) => {
  const scoredSignal: ProcedureBucketScoredSignal = {
    chain: {
      chainId: signal.chain.chainId,
      parentNodeId: signal.signalId,
      parentSignalId: signal.signalId,
      rootSourceId: signal.chain.rootSourceId,
    },
    payload: {
      aggregateScore: scored.score.aggregateScore,
      bucketKey: scored.bucket.bucketKey,
      confidence: scored.score.confidence,
      domain: scored.bucket.domain,
      itemScores: scored.score.itemScores,
      recordIds: scored.bucket.recordIds,
      suggestedActions: scored.score.suggestedActions,
    },
    signalId: `${signal.signalId}:signal:procedure-accumulated`,
    signalType: AGENT_SIGNAL_POLICY_SIGNAL_TYPES.procedureBucketScored,
    source: signal.source,
    timestamp: scored.score.scoredAt,
  };

  return transitionToSignals(scoredSignal, {
    reason: 'dispatch accumulated procedure score signal',
  });
};
