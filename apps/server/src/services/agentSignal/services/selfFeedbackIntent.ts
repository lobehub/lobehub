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
import { redisService } from '@/server/services/redis';

import { AGENT_SIGNAL_DEFAULTS } from '../constants';
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

/**
 * Counts accepted declarations per scope so a fast-looping agent cannot flood the queue.
 */
export interface SelfFeedbackIntentDeclarationLimiter {
  /**
   * Takes one declaration slot for the scope.
   *
   * Returns:
   * - `true` when the scope is still within `limit`, otherwise `false`
   */
  acquire: (scopeKey: string, limit: number) => Promise<boolean>;
  /** Returns a slot taken by `acquire` when the declaration was not enqueued. */
  release: (scopeKey: string) => Promise<void>;
}

/**
 * Creates a process-local declaration limiter.
 *
 * Use when:
 * - Tests or single-process tools need the declaration limit without Redis
 */
export const createInMemoryDeclarationLimiter = (): SelfFeedbackIntentDeclarationLimiter => {
  const counts = new Map<string, number>();

  return {
    acquire: async (scopeKey, limit) => {
      const next = (counts.get(scopeKey) ?? 0) + 1;
      counts.set(scopeKey, next);

      return next <= limit;
    },
    release: async (scopeKey) => {
      counts.set(scopeKey, Math.max(0, (counts.get(scopeKey) ?? 0) - 1));
    },
  };
};

/**
 * Creates the Redis-backed declaration limiter shared by every server process.
 *
 * Use when:
 * - The declaration tool runs on serverless instances that do not share memory
 *
 * Returns:
 * - A limiter that fails closed (rejects) when Redis is missing or errors, because each
 *   accepted declaration can spawn a background run billed to the user
 */
export const createRedisDeclarationLimiter = (): SelfFeedbackIntentDeclarationLimiter => ({
  acquire: async (scopeKey, limit) => {
    try {
      const count = await redisService.agentSignal.takeDeclarationSlot(scopeKey);

      return count !== undefined && count <= limit;
    } catch (error) {
      console.error('[AgentSignal] Failed to read self-feedback intent limit:', error);
      return false;
    }
  },
  release: async (scopeKey) => {
    try {
      await redisService.agentSignal.releaseDeclarationSlot(scopeKey);
    } catch (error) {
      console.error('[AgentSignal] Failed to release self-feedback intent slot:', error);
    }
  },
});

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
  /**
   * Per-scope declaration limiter.
   *
   * @default A process-local limiter. Production wiring passes the Redis-backed limiter.
   */
  declarationLimiter?: SelfFeedbackIntentDeclarationLimiter;
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

const DECLARATION_LIMIT_PER_SCOPE =
  AGENT_SIGNAL_DEFAULTS.selfFeedbackIntentDeclarationLimitPerScope;
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
 * - `declarationLimiter` owns fast-loop rate limiting (in-memory unless injected)
 *
 * Returns:
 * - A service that emits accepted declarations and never mutates memory or skill resources
 */
export const createSelfFeedbackIntentService = (
  deps: SelfFeedbackIntentServiceDependencies,
): SelfFeedbackIntentService => {
  const limiter = deps.declarationLimiter ?? createInMemoryDeclarationLimiter();

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

      if (!(await limiter.acquire(rateLimitScopeKey, DECLARATION_LIMIT_PER_SCOPE))) {
        await limiter.release(rateLimitScopeKey);
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

      // Only accepted declarations keep their slot; rejected or failed ones give it back.
      try {
        if (deps.canEnqueue && !(await deps.canEnqueue(sourceEvent))) {
          await limiter.release(rateLimitScopeKey);
          return { accepted: false, reason: 'enqueue_gate_rejected', sourceId, strength };
        }

        await deps.enqueueSource(sourceEvent);
      } catch (error) {
        await limiter.release(rateLimitScopeKey);
        throw error;
      }

      return { accepted: true, sourceId, strength };
    },
  };
};
