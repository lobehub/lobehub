import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';

import type { SelfReflectionRequestReason } from '../procedure/accumulators/selfReflection';
import { buildSelfReflectionSourceId } from './maintenance/types';

type MaybePromise<TValue> = TValue | Promise<TValue>;

/** Runtime scope supported by self-reflection source requests. */
export type SelfReflectionRequestScopeType = 'operation' | 'task' | 'topic';

/** Source event input emitted by the self-reflection request service. */
export type SelfReflectionSourceEventInput =
  AgentSignalSourceEventInput<'agent.self_reflection.requested'>;

/**
 * Input used to request one self-reflection source event.
 */
export interface RequestSelfReflectionInput {
  /** Stable agent id associated with the weak-signal window. */
  agentId: string;
  /** Runtime operation id when the request is scoped to an operation or references one. */
  operationId?: string;
  /** Threshold or policy reason that triggered reflection. */
  reason: SelfReflectionRequestReason;
  /** Topic, task, or operation id selected by the accumulator. */
  scopeId: string;
  /** Runtime scope family selected by the accumulator. */
  scopeType: SelfReflectionRequestScopeType;
  /** Task id when the request is scoped to or associated with a task. */
  taskId?: string;
  /** Topic id when the request is scoped to or associated with a topic. */
  topicId?: string;
  /** Stable user id associated with the weak-signal window. */
  userId: string;
  /** ISO timestamp for the end of the reflection window. */
  windowEnd: string;
  /** ISO timestamp for the beginning of the reflection window. */
  windowStart: string;
}

/** Result returned after a self-reflection request attempt. */
export interface RequestSelfReflectionResult {
  /** Whether the service called the source enqueue boundary. */
  enqueued: boolean;
  /** Optional skip reason when a gate rejected the request. */
  reason?: 'enqueue_gate_rejected' | 'request_gate_rejected';
  /** Stable source id built for this request when available. */
  sourceId?: string;
}

/** Dependencies used by the pure self-reflection source emission service. */
export interface SelfReflectionServiceDependencies {
  /**
   * Optional final gate for a fully built source event.
   *
   * @default Allows enqueueing.
   */
  canEnqueue?: (input: SelfReflectionSourceEventInput) => MaybePromise<boolean>;
  /**
   * Optional request-level gate checked before source event construction crosses enqueue boundaries.
   *
   * @default Allows requests.
   */
  canRequestSelfReflection?: (input: RequestSelfReflectionInput) => MaybePromise<boolean>;
  /** Enqueues one self-reflection source event. */
  enqueueSource: (input: SelfReflectionSourceEventInput) => Promise<unknown>;
}

/** Self-reflection source emission service API. */
export interface SelfReflectionService {
  /**
   * Emits one self-reflection source request when injected gates allow it.
   *
   * Use when:
   * - A runtime weak-signal accumulator crosses a self-reflection threshold
   * - Callers need source-event emission without DB writes or handler execution
   *
   * Expects:
   * - The input came from a real task, operation, or topic scoped runtime signal
   * - Source dedupe is handled by the Agent Signal enqueue/store path
   *
   * Returns:
   * - Whether the enqueue boundary was called and the stable source id when built
   */
  requestSelfReflection: (
    input: RequestSelfReflectionInput,
  ) => Promise<RequestSelfReflectionResult>;
}

/**
 * Creates a pure self-reflection source emission service.
 *
 * Use when:
 * - Tests need deterministic source ids and queue payloads
 * - Runtime integration wants DI-friendly feature gates and enqueue boundaries
 *
 * Expects:
 * - `enqueueSource` owns durable dedupe and async execution
 * - Optional gates are side-effect-light checks
 *
 * Returns:
 * - A service that calls `enqueueSource` at most once for each allowed request
 */
export const createSelfReflectionService = (
  deps: SelfReflectionServiceDependencies,
): SelfReflectionService => ({
  requestSelfReflection: async (input) => {
    if (deps.canRequestSelfReflection && !(await deps.canRequestSelfReflection(input))) {
      return { enqueued: false, reason: 'request_gate_rejected' };
    }

    const sourceId = buildSelfReflectionSourceId({
      agentId: input.agentId,
      reason: input.reason,
      scopeId: input.scopeId,
      scopeType: input.scopeType,
      userId: input.userId,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    });
    const sourceEvent: SelfReflectionSourceEventInput = {
      payload: {
        agentId: input.agentId,
        reason: input.reason,
        scopeId: input.scopeId,
        scopeType: input.scopeType,
        ...(input.operationId ? { operationId: input.operationId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.topicId ? { topicId: input.topicId } : {}),
        userId: input.userId,
        windowEnd: input.windowEnd,
        windowStart: input.windowStart,
      },
      sourceId,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    };

    if (deps.canEnqueue && !(await deps.canEnqueue(sourceEvent))) {
      return { enqueued: false, reason: 'enqueue_gate_rejected', sourceId };
    }

    await deps.enqueueSource(sourceEvent);

    return { enqueued: true, sourceId };
  },
});
