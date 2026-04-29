import type { BaseAction, BaseSignal, RuntimeProcessorResult } from '@lobechat/agent-signal';

import type {
  AgentSignalProcedureMarker,
  AgentSignalProcedureRecord,
  ProcedureAccumulatorScoreResult,
} from '../../procedure';
import { createProcedureKey, createProcedureMarker, createProcedureRecord } from '../../procedure';
import type { RuntimeProcessorContext } from '../../runtime/context';
import { defineSignalHandler } from '../../runtime/middleware';
import {
  AGENT_SIGNAL_POLICY_ACTION_TYPES,
  AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
  type AgentSignalFeedbackDomainTarget,
  type AgentSignalFeedbackSourceHints,
} from '../types';

/**
 * Builds the durable action idempotency key for one planned feedback action.
 *
 * The key intentionally uses the root source id, target domain, and message id so retries of the
 * same feedback source do not replay durable side effects, while memory and skill fan-out actions
 * stay independent from each other.
 *
 * Before:
 * - rootSourceId="msg_1", target="skill", messageId="msg_1"
 *
 * After:
 * - "msg_1:skill:msg_1"
 */
const createStableIdempotencyKey = (
  signal: BaseSignal,
  target: AgentSignalFeedbackDomainTarget,
  messageId: string,
) => {
  return `${signal.chain.rootSourceId}:${target}:${messageId}`;
};

/**
 * Weak positive skill feedback needs repeated observations before the accumulator emits.
 */
const SATISFIED_SKILL_CHEAP_SCORE_DELTA = 0.6;

/**
 * Procedure dependencies used by the feedback action planner.
 */
export interface FeedbackActionProcedureDeps {
  /** Appends candidate records and optionally scores accumulated buckets. */
  accumulator?: {
    appendAndScore?: (
      record: AgentSignalProcedureRecord,
    ) => Promise<ProcedureAccumulatorScoreResult | undefined>;
    appendRecord: (record: AgentSignalProcedureRecord) => Promise<void>;
  };
  /** Writes accumulated markers after a bucket score is emitted. */
  markerStore?: { write: (marker: AgentSignalProcedureMarker) => Promise<void> };
  /** Provides a consistent millisecond timestamp for procedure writes. */
  now?: () => number;
  /** Writes candidate procedure records. */
  recordStore?: { write: (record: AgentSignalProcedureRecord) => Promise<void> };
  /** TTL used for marker expiration. */
  ttlSeconds?: number;
}

/**
 * Options for feedback action planning.
 */
export interface FeedbackActionPlannerOptions {
  /** Optional procedure marker reader used to suppress same-source duplicate actions. */
  markerReader?: {
    shouldSuppress: (input: {
      domainKey: string;
      intentClass?: string;
      intentClassCandidates?: string[];
      procedureKey: string;
      scopeKey: string;
    }) => Promise<boolean>;
  };
  /** Optional procedure dependencies used for weak-signal accumulation. */
  procedure?: FeedbackActionProcedureDeps;
}

const toDomainKey = (target: AgentSignalFeedbackDomainTarget) => {
  if (target === 'memory') return 'memory:user-preference';
  if (target === 'skill') return 'skill';
  return target;
};

const toPlannerIntentClass = (
  result?: 'not_satisfied' | 'neutral' | 'satisfied',
): 'implicit_positive' | 'unknown' => {
  return result === 'satisfied' ? 'implicit_positive' : 'unknown';
};

const toPlannerIntentClassCandidates = (
  target: AgentSignalFeedbackDomainTarget,
  result?: 'not_satisfied' | 'neutral' | 'satisfied',
) => {
  const primary = toPlannerIntentClass(result);
  if (target === 'memory') return [primary, 'explicit_persistence', 'unknown'];
  if (target === 'skill') return [primary, 'tool_command', 'explicit_persistence', 'unknown'];
  return [primary, 'unknown'];
};

const buildActionNodes = (signal: BaseSignal): BaseAction[] => {
  const payload = signal.payload as {
    agentId?: string;
    conflictPolicy?: {
      forbiddenWith?: AgentSignalFeedbackDomainTarget[];
      mode: 'exclusive' | 'fanout';
      priority: number;
    };
    evidence?: Array<{
      cue: string;
      excerpt: string;
    }>;
    message: string;
    messageId: string;
    reason?: string;
    satisfactionResult?: 'not_satisfied' | 'neutral' | 'satisfied';
    sourceHints?: AgentSignalFeedbackSourceHints;
    target: AgentSignalFeedbackDomainTarget;
    topicId?: string;
  };
  const sourcePayload =
    signal.source && 'payload' in signal.source && signal.source.payload
      ? (signal.source.payload as Record<string, unknown>)
      : undefined;
  const serializedContext =
    typeof sourcePayload?.serializedContext === 'string'
      ? sourcePayload.serializedContext
      : undefined;

  const idempotencyKey = createStableIdempotencyKey(signal, payload.target, payload.messageId);

  if (payload.target === 'memory') {
    return [
      {
        actionId: `${signal.signalId}:action:memory`,
        actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle,
        chain: {
          chainId: signal.chain.chainId,
          parentNodeId: signal.signalId,
          parentSignalId: signal.signalId,
          rootSourceId: signal.chain.rootSourceId,
        },
        payload: {
          agentId: payload.agentId,
          conflictPolicy: payload.conflictPolicy,
          evidence: payload.evidence,
          feedbackHint: payload.satisfactionResult === 'satisfied' ? 'satisfied' : 'not_satisfied',
          idempotencyKey,
          message: payload.message,
          messageId: payload.messageId,
          reason: payload.reason,
          serializedContext,
          sourceHints: payload.sourceHints,
          topicId: payload.topicId,
        },
        signal: {
          signalId: signal.signalId,
          signalType: signal.signalType,
        },
        source: signal.source,
        timestamp: signal.timestamp,
      },
    ];
  }

  if (payload.target === 'skill') {
    if (payload.satisfactionResult === 'satisfied') return [];

    return [
      {
        actionId: `${signal.signalId}:action:skill-management`,
        actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
        chain: {
          chainId: signal.chain.chainId,
          parentNodeId: signal.signalId,
          parentSignalId: signal.signalId,
          rootSourceId: signal.chain.rootSourceId,
        },
        payload: {
          agentId: payload.agentId,
          conflictPolicy: payload.conflictPolicy,
          evidence: payload.evidence,
          feedbackHint: 'not_satisfied',
          idempotencyKey,
          message: payload.message,
          messageId: payload.messageId,
          reason: payload.reason,
          serializedContext,
          sourceHints: payload.sourceHints,
          topicId: payload.topicId,
        },
        signal: {
          signalId: signal.signalId,
          signalType: signal.signalType,
        },
        source: signal.source,
        timestamp: signal.timestamp,
      },
    ];
  }

  return [];
};

const buildSuppressedProcedureSignal = (signal: BaseSignal, context: RuntimeProcessorContext) => {
  const payload = signal.payload as {
    messageId: string;
    target: AgentSignalFeedbackDomainTarget;
  };
  const domain = toDomainKey(payload.target);

  return {
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
  } satisfies BaseSignal;
};

const buildScoredProcedureSignal = (signal: BaseSignal, scored: ProcedureAccumulatorScoreResult) =>
  ({
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
  }) satisfies BaseSignal;

const createSatisfiedSkillCandidateRecord = (
  signal: BaseSignal,
  context: RuntimeProcessorContext,
  now: number,
) => {
  const payload = signal.payload as {
    message: string;
    messageId: string;
    reason?: string;
    satisfactionResult?: 'not_satisfied' | 'neutral' | 'satisfied';
    target: AgentSignalFeedbackDomainTarget;
  };

  return createProcedureRecord({
    accumulatorRole: 'candidate',
    cheapScoreDelta: SATISFIED_SKILL_CHEAP_SCORE_DELTA,
    createdAt: now,
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
};

const maybeAccumulateSatisfiedSkillFeedback = async (
  signal: BaseSignal,
  context: RuntimeProcessorContext,
  options: FeedbackActionPlannerOptions,
) => {
  const payload = signal.payload as {
    messageId: string;
    satisfactionResult?: 'not_satisfied' | 'neutral' | 'satisfied';
    target: AgentSignalFeedbackDomainTarget;
  };

  if (payload.target !== 'skill' || payload.satisfactionResult !== 'satisfied') return undefined;

  const procedure = options.procedure;
  if (!procedure?.recordStore || !procedure.accumulator) return undefined;

  const now = procedure.now?.() ?? context.now();
  const record = createSatisfiedSkillCandidateRecord(signal, context, now);

  await procedure.recordStore.write(record);

  if (!procedure.accumulator.appendAndScore) {
    await procedure.accumulator.appendRecord(record);
    return undefined;
  }

  const scored = await procedure.accumulator.appendAndScore(record);
  if (!scored) return undefined;
  if (scored.score.aggregateScore < 1 && !scored.score.suggestedActions.includes('maintain')) {
    return undefined;
  }

  const scoredSignal = buildScoredProcedureSignal(signal, scored);

  if (procedure.markerStore && procedure.ttlSeconds) {
    await procedure.markerStore.write(
      createProcedureMarker({
        createdAt: now,
        domainKey: 'skill',
        expiresAt: now + procedure.ttlSeconds * 1000,
        intentClass: toPlannerIntentClass(payload.satisfactionResult),
        markerType: 'accumulated',
        procedureKey: createProcedureKey({
          messageId: payload.messageId,
          rootSourceId: signal.chain.rootSourceId,
        }),
        recordId: record.id,
        scopeKey: context.scopeKey,
        signalId: scoredSignal.signalId,
        sourceId: signal.source?.sourceId,
      }),
    );
  }

  return scoredSignal;
};

/**
 * Builds planned action nodes unless procedure markers suppress the same-source work.
 *
 * Use when:
 * - Feedback domain signals may overlap with direct tool outcomes
 * - Planner suppression must read marker state only
 *
 * Expects:
 * - `messageId` is present on feedback domain signals
 *
 * Returns:
 * - Planned actions and whether they were suppressed
 */
const buildPlannedActions = async (
  signal: BaseSignal,
  context: RuntimeProcessorContext,
  options: FeedbackActionPlannerOptions,
) => {
  const payload = signal.payload as {
    messageId: string;
    satisfactionResult?: 'not_satisfied' | 'neutral' | 'satisfied';
    target: AgentSignalFeedbackDomainTarget;
  };
  const suppressed = await options.markerReader?.shouldSuppress({
    domainKey: toDomainKey(payload.target),
    intentClass: toPlannerIntentClass(payload.satisfactionResult),
    intentClassCandidates: toPlannerIntentClassCandidates(
      payload.target,
      payload.satisfactionResult,
    ),
    procedureKey: `message:${payload.messageId}`,
    scopeKey: context.scopeKey,
  });

  if (suppressed) return { actions: [], suppressed: true };

  const scoredSignal = await maybeAccumulateSatisfiedSkillFeedback(signal, context, options);

  return {
    actions: buildActionNodes(signal),
    signals: scoredSignal ? [scoredSignal] : [],
    suppressed: false,
  };
};

/**
 * Creates the signal handler that turns domain signals into action lists.
 *
 * Triggering workflow:
 *
 * {@link createFeedbackDomainJudgeSignalHandler}
 *   -> `signal.feedback.domain.*`
 *     -> {@link createFeedbackActionPlannerSignalHandler}
 *
 * Upstream:
 * - {@link createFeedbackDomainJudgeSignalHandler}
 *
 * Downstream:
 * - `action.user-memory.handle`
 * - `action.skill-management.handle`
 */
export const createFeedbackActionPlannerSignalHandler = (
  options: FeedbackActionPlannerOptions = {},
) => {
  const listenedSignalTypes = [
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainNone,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainSkill,
  ] as const;

  return defineSignalHandler(
    listenedSignalTypes,
    'signal.feedback-action-planner',
    async (signal, context): Promise<RuntimeProcessorResult | void> => {
      const {
        actions,
        signals = [],
        suppressed,
      } = await buildPlannedActions(signal, context, options);

      if (suppressed) {
        return {
          signals: [buildSuppressedProcedureSignal(signal, context)],
          status: 'dispatch',
        };
      }

      if (actions.length === 0 && signals.length === 0) {
        return;
      }

      return {
        actions,
        signals,
        status: 'dispatch',
      };
    },
  );
};
