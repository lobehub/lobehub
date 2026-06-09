import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type {
  DeclareSelfFeedbackIntentInput,
  DeclareSelfFeedbackIntentPayload,
  DeclareSelfFeedbackIntentResult,
  SelfFeedbackIntentAction,
  SelfFeedbackIntentKind,
  SelfFeedbackIntentStrength,
} from '@lobechat/builtin-tool-self-iteration';
import {
  SELF_FEEDBACK_INTENT_ACTIONS,
  SELF_FEEDBACK_INTENT_KINDS,
} from '@lobechat/builtin-tool-self-iteration';

import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';

import { buildSelfFeedbackIntentSourceId } from './selfIteration/types';

export type {
  DeclareSelfFeedbackIntentInput,
  DeclareSelfFeedbackIntentPayload,
  DeclareSelfFeedbackIntentResult,
  SelfFeedbackIntentAction,
  SelfFeedbackIntentKind,
  SelfFeedbackIntentStrength,
} from '@lobechat/builtin-tool-self-iteration';

type MaybePromise<TValue> = TValue | Promise<TValue>;

/** Source event input emitted by the self-feedback intent declaration service. */
export type SelfFeedbackIntentSourceEventInput =
  AgentSignalSourceEventInput<'agent.self_feedback_intent.declared'>;

/** Dependencies used by the pure self-feedback intent declaration service. */
export interface SelfFeedbackIntentServiceDependencies {
  /**
   * Optional declaration-level gate checked before source event construction crosses enqueue
   * boundaries.
   *
   * @default Allows declarations.
   */
  canDeclareIntent?: (input: DeclareSelfFeedbackIntentInput) => MaybePromise<boolean>;
  /**
   * Optional final gate for a fully built source event.
   *
   * @default Allows enqueueing.
   */
  canEnqueue?: (input: SelfFeedbackIntentSourceEventInput) => MaybePromise<boolean>;
  /** Enqueues one self-feedback intent source event. */
  enqueueSource: (input: SelfFeedbackIntentSourceEventInput) => Promise<unknown>;
  /** Creates a stable tool-call id when the caller did not provide one. */
  nextToolCallId: () => string;
}

/** Self-iteration intent source emission service API. */
export interface SelfFeedbackIntentService {
  /**
   * Emits one agent-declared self-feedback intent source event when validation and gates pass.
   *
   * Use when:
   * - A running chat or task agent wants to declare self-feedback intent
   * - Callers need a source-event boundary without direct memory or skill mutation
   *
   * Expects:
   * - `topicId`, `agentId`, and `userId` identify the current running agent scope
   * - Downstream Agent Signal handlers own planning, review, and resource mutation decisions
   *
   * Returns:
   * - Source acceptance status, stable source id when emitted, and evidence strength
   */
  declareIntent: (
    input: DeclareSelfFeedbackIntentInput,
  ) => Promise<DeclareSelfFeedbackIntentResult>;
}

const DECLARATION_LIMIT_PER_SCOPE = 3;
const STRONG_CONFIDENCE_THRESHOLD = 0.75;

const validActions = new Set<SelfFeedbackIntentAction>(SELF_FEEDBACK_INTENT_ACTIONS);
const validKinds = new Set<SelfFeedbackIntentKind>(SELF_FEEDBACK_INTENT_KINDS);

const getStrength = (input: DeclareSelfFeedbackIntentPayload): SelfFeedbackIntentStrength => {
  if (!input.evidenceRefs?.length || input.confidence < STRONG_CONFIDENCE_THRESHOLD) {
    return 'weak';
  }

  return 'strong';
};

const getRateLimitScopeKey = (input: DeclareSelfFeedbackIntentInput) => {
  const scopeKey = input.operationId ? `operation:${input.operationId}` : `topic:${input.topicId}`;

  return `${input.userId}:${input.agentId}:${scopeKey}`;
};

const getIntentScope = (input: DeclareSelfFeedbackIntentInput) =>
  input.operationId
    ? ({
        scopeId: input.operationId,
        scopeKey: `operation:${input.operationId}`,
        scopeType: 'operation',
      } as const)
    : ({ scopeId: input.topicId, scopeKey: `topic:${input.topicId}`, scopeType: 'topic' } as const);

const isValidConfidence = (confidence: number) =>
  Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;

/**
 * Creates a pure self-feedback intent declaration service.
 *
 * Use when:
 * - Runtime tool handlers need a DI-friendly source emission boundary
 * - Tests need deterministic tool-call ids, gates, and rate-limit state
 *
 * Expects:
 * - `enqueueSource` owns durable dedupe and async execution
 * - The service instance owns only in-memory fast-loop rate limiting
 *
 * Returns:
 * - A service that emits accepted declarations and never mutates memory or skill resources
 */
export const createSelfFeedbackIntentService = (
  deps: SelfFeedbackIntentServiceDependencies,
): SelfFeedbackIntentService => {
  const acceptedCounts = new Map<string, number>();

  return {
    declareIntent: async (input) => {
      if (!validActions.has(input.input.action)) {
        return { accepted: false, reason: 'invalid_action', strength: 'weak' };
      }

      if (!validKinds.has(input.input.kind)) {
        return { accepted: false, reason: 'invalid_kind', strength: 'weak' };
      }

      if (!isValidConfidence(input.input.confidence)) {
        return { accepted: false, reason: 'invalid_confidence', strength: 'weak' };
      }

      const strength = getStrength(input.input);

      if (deps.canDeclareIntent && !(await deps.canDeclareIntent(input))) {
        return { accepted: false, reason: 'intent_gate_rejected', strength };
      }

      const rateLimitScopeKey = getRateLimitScopeKey(input);
      const acceptedCount = acceptedCounts.get(rateLimitScopeKey) ?? 0;

      if (acceptedCount >= DECLARATION_LIMIT_PER_SCOPE) {
        return { accepted: false, reason: 'rate_limited', strength };
      }

      const toolCallId = input.toolCallId ?? deps.nextToolCallId();
      const intentScope = getIntentScope(input);
      const sourceId = buildSelfFeedbackIntentSourceId({
        agentId: input.agentId,
        scopeId: intentScope.scopeId,
        scopeType: intentScope.scopeType,
        toolCallId,
        userId: input.userId,
      });
      const sourceEvent: SelfFeedbackIntentSourceEventInput = {
        payload: {
          action: input.input.action,
          agentId: input.agentId,
          confidence: input.input.confidence,
          kind: input.input.kind,
          reason: input.input.reason,
          summary: input.input.summary,
          toolCallId,
          topicId: input.topicId,
          userId: input.userId,
          ...(input.input.evidenceRefs ? { evidenceRefs: input.input.evidenceRefs } : {}),
          ...(input.input.memoryId ? { memoryId: input.input.memoryId } : {}),
          ...(input.operationId ? { operationId: input.operationId } : {}),
          ...(input.input.skillId ? { skillId: input.input.skillId } : {}),
        },
        scopeKey: intentScope.scopeKey,
        sourceId,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
      };

      if (deps.canEnqueue && !(await deps.canEnqueue(sourceEvent))) {
        return { accepted: false, reason: 'enqueue_gate_rejected', sourceId, strength };
      }

      await deps.enqueueSource(sourceEvent);
      acceptedCounts.set(rateLimitScopeKey, acceptedCount + 1);

      return { accepted: true, sourceId, strength };
    },
  };
};
