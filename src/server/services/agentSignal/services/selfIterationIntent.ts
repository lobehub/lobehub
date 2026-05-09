import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';

import type { EvidenceRef } from './maintenance/types';
import { buildSelfIterationIntentSourceId } from './maintenance/types';

type MaybePromise<TValue> = TValue | Promise<TValue>;

/** Actions that an agent may declare as self-iteration maintenance intent. */
export type SelfIterationIntentAction = 'write' | 'create' | 'refine' | 'consolidate' | 'proposal';

/** Maintenance target categories accepted from agent-declared intent. */
export type SelfIterationIntentKind = 'memory' | 'skill' | 'gap';

/** Evidence strength assigned to one accepted or rejected declaration. */
export type SelfIterationIntentStrength = 'strong' | 'weak';

/** Source event input emitted by the self-iteration intent declaration service. */
export type SelfIterationIntentSourceEventInput =
  AgentSignalSourceEventInput<'agent.self_iteration_intent.declared'>;

/** Input payload declared by the running agent through the self-iteration intent tool. */
export interface DeclareSelfIterationIntentPayload {
  /** Maintenance action the agent believes may be useful. */
  action: SelfIterationIntentAction;
  /** Agent confidence from 0 to 1. */
  confidence: number;
  /** Evidence references that justify the declaration. */
  evidenceRefs?: EvidenceRef[];
  /** Target category for the declaration. */
  kind: SelfIterationIntentKind;
  /** Existing memory id when the declaration targets a known memory. */
  memoryId?: string;
  /** Human-readable rationale from the agent. */
  reason: string;
  /** Existing skill id when the declaration targets a known skill. */
  skillId?: string;
  /** Short declaration summary for downstream review. */
  summary: string;
}

/** Input used to declare one agent-facing self-iteration intent source event. */
export interface DeclareSelfIterationIntentInput {
  /** Stable agent id associated with the running agent. */
  agentId: string;
  /** Agent-declared maintenance intent payload. */
  input: DeclareSelfIterationIntentPayload;
  /** Runtime operation id when the declaration belongs to a narrower operation scope. */
  operationId?: string;
  /** Caller-provided tool-call id. When omitted, the injected id generator is used. */
  toolCallId?: string;
  /** Current topic id for stable source ids and topic fallback scope. */
  topicId: string;
  /** Stable user id associated with the running agent. */
  userId: string;
}

/** Result returned after one declaration attempt. */
export interface DeclareSelfIterationIntentResult {
  /** Whether the declaration was accepted and emitted to the enqueue boundary. */
  accepted: boolean;
  /** Optional rejection reason when no source was enqueued. */
  reason?:
    | 'enqueue_gate_rejected'
    | 'intent_gate_rejected'
    | 'invalid_action'
    | 'invalid_confidence'
    | 'invalid_kind'
    | 'rate_limited';
  /** Stable source id built for accepted declarations when available. */
  sourceId?: string;
  /** Evidence strength assigned from confidence and evidence presence. */
  strength: SelfIterationIntentStrength;
}

/** Dependencies used by the pure self-iteration intent declaration service. */
export interface SelfIterationIntentServiceDependencies {
  /**
   * Optional declaration-level gate checked before source event construction crosses enqueue
   * boundaries.
   *
   * @default Allows declarations.
   */
  canDeclareIntent?: (input: DeclareSelfIterationIntentInput) => MaybePromise<boolean>;
  /**
   * Optional final gate for a fully built source event.
   *
   * @default Allows enqueueing.
   */
  canEnqueue?: (input: SelfIterationIntentSourceEventInput) => MaybePromise<boolean>;
  /** Enqueues one self-iteration intent source event. */
  enqueueSource: (input: SelfIterationIntentSourceEventInput) => Promise<unknown>;
  /** Creates a stable tool-call id when the caller did not provide one. */
  nextToolCallId: () => string;
}

/** Self-iteration intent source emission service API. */
export interface SelfIterationIntentService {
  /**
   * Emits one agent-declared self-iteration intent source event when validation and gates pass.
   *
   * Use when:
   * - A running chat or task agent wants to declare maintenance intent
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
    input: DeclareSelfIterationIntentInput,
  ) => Promise<DeclareSelfIterationIntentResult>;
}

const DECLARATION_LIMIT_PER_SCOPE = 3;
const STRONG_CONFIDENCE_THRESHOLD = 0.75;

const validActions = new Set<SelfIterationIntentAction>([
  'write',
  'create',
  'refine',
  'consolidate',
  'proposal',
]);
const validKinds = new Set<SelfIterationIntentKind>(['memory', 'skill', 'gap']);

const getStrength = (input: DeclareSelfIterationIntentPayload): SelfIterationIntentStrength => {
  if (!input.evidenceRefs?.length || input.confidence < STRONG_CONFIDENCE_THRESHOLD) {
    return 'weak';
  }

  return 'strong';
};

const getRateLimitScopeKey = (input: DeclareSelfIterationIntentInput) => {
  const scopeKey = input.operationId ? `operation:${input.operationId}` : `topic:${input.topicId}`;

  return `${input.userId}:${input.agentId}:${scopeKey}`;
};

const getIntentScope = (input: DeclareSelfIterationIntentInput) =>
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
 * Creates a pure self-iteration intent declaration service.
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
export const createSelfIterationIntentService = (
  deps: SelfIterationIntentServiceDependencies,
): SelfIterationIntentService => {
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
      const sourceId = buildSelfIterationIntentSourceId({
        agentId: input.agentId,
        scopeId: intentScope.scopeId,
        scopeType: intentScope.scopeType,
        toolCallId,
        userId: input.userId,
      });
      const sourceEvent: SelfIterationIntentSourceEventInput = {
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
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
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
