import type { SourceAgentSelfReflectionRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { createAgentSignalSelfIterationPrompt } from '@lobechat/prompts';
import { isNonEmptyString } from '@lobechat/utils';

import type { LobeChatDatabase } from '@/database/type';

import { defineSourceHandler } from '../../../runtime/middleware';
import { enqueueSelfIterationRun } from '../dispatch/enqueueSelfIterationRun';
import { buildSelfReflectionSourceId, ReviewRunStatus } from '../types';

/** Runtime scope supported by self-reflection source handlers. */
export type SelfReflectionSourceScopeType = 'operation' | 'task' | 'topic';

/**
 * Validated self-reflection request payload consumed by the handler.
 */
export interface SelfReflectionSourcePayload {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Runtime operation id when the source is operation-scoped or associated with one. */
  operationId?: string;
  /** Threshold or policy reason that requested reflection. */
  reason: string;
  /** Topic, task, or operation id selected for bounded evidence collection. */
  scopeId: string;
  /** Runtime scope family selected by the source producer. */
  scopeType: SelfReflectionSourceScopeType;
  /** Task id when the source is task-scoped or associated with one. */
  taskId?: string;
  /** Topic id when the source is topic-scoped or associated with one. */
  topicId?: string;
  /** Stable user id owning the agent. */
  userId: string;
  /** Reflection window end as an ISO string. */
  windowEnd: string;
  /** Reflection window start as an ISO string. */
  windowStart: string;
}

/**
 * Idempotency and gate input shared by self-reflection handler dependencies.
 */
export interface SelfReflectionSourceGuardInput extends SelfReflectionSourcePayload {
  /** Stable guard key for one scoped self-reflection window. */
  guardKey: string;
  /** Normalized source id that triggered the run. */
  sourceId: string;
}

/**
 * Scoped evidence collection input for self-reflection reviews.
 */
export interface CollectSelfReflectionContextInput {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Runtime operation id when the bounded evidence scope references one. */
  operationId?: string;
  /** Topic, task, or operation id selected for bounded evidence collection. */
  scopeId: string;
  /** Runtime scope family selected by the source producer. */
  scopeType: SelfReflectionSourceScopeType;
  /** Task id when the bounded evidence scope references one. */
  taskId?: string;
  /** Topic id when the bounded evidence scope references one. */
  topicId?: string;
  /** Stable user id owning the agent. */
  userId: string;
  /** Reflection window end as an ISO string. */
  windowEnd: string;
  /** Reflection window start as an ISO string. */
  windowStart: string;
}

/**
 * Review context collected for one self-reflection run.
 */
export interface SelfReflectionReviewContext extends CollectSelfReflectionContextInput {
  /** Additional collector-specific evidence fields. */
  [key: string]: unknown;
}

/**
 * Result returned by the self-reflection source handler.
 */
export interface SelfReflectionSourceHandlerResult extends Record<string, unknown> {
  /** Stable agent id being reviewed when payload validation succeeds. */
  agentId?: string;
  /** Stable guard key used for idempotency when payload validation succeeds. */
  guardKey?: string;
  /** Operation id of the enqueued background self-iteration run, when dispatched. */
  operationId?: string;
  /** Machine-readable skip reason for non-dispatched runs. */
  reason?: 'gate_disabled' | 'invalid_payload';
  /** Topic, task, or operation id selected for bounded evidence collection. */
  scopeId?: string;
  /** Runtime scope family selected by the source producer. */
  scopeType?: SelfReflectionSourceScopeType;
  /** Source id that triggered the run. */
  sourceId?: string;
  /** Coarse run status for observability and retry semantics. */
  status: ReviewRunStatus;
  /** Stable user id owning the agent when payload validation succeeds. */
  userId?: string;
  /** Reflection window end as an ISO string when payload validation succeeds. */
  windowEnd?: string;
  /** Reflection window start as an ISO string when payload validation succeeds. */
  windowStart?: string;
}

/**
 * Dependencies required by the self-reflection source handler.
 */
export interface CreateSelfReflectionSourceHandlerDependencies {
  /** Acquires the per-user-agent-scope window idempotency guard. */
  acquireReviewGuard: (input: SelfReflectionSourceGuardInput) => Promise<boolean>;
  /** Re-checks runtime gates before doing reviewer work. */
  canRunReview: (input: SelfReflectionSourceGuardInput) => Promise<boolean>;
  /** Collects only source-scoped evidence without mutating shared resources. */
  collectContext: (
    input: CollectSelfReflectionContextInput,
  ) => Promise<SelfReflectionReviewContext>;
  /** Postgres handle used by the dispatch helper to enqueue the execAgent run. */
  db: LobeChatDatabase;
  /** Enqueues the async self-iteration run. Overridable for tests. */
  dispatch?: typeof enqueueSelfIterationRun;
  /**
   * Maximum self-iteration runtime steps.
   *
   * @default builtin agent default
   */
  maxSteps?: number;
  /** Workspace id, threaded so the enqueued run targets the correct workspace. */
  workspaceId?: string;
}

const isSelfReflectionScopeType = (value: unknown): value is SelfReflectionSourceScopeType =>
  value === 'topic' || value === 'task' || value === 'operation';

const readSelfReflectionPayload = (
  source: SourceAgentSelfReflectionRequested,
): SelfReflectionSourcePayload | undefined => {
  if (source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested) return;

  const payload = source.payload;
  if (
    !isNonEmptyString(payload.agentId) ||
    !isNonEmptyString(payload.reason) ||
    !isNonEmptyString(payload.scopeId) ||
    !isSelfReflectionScopeType(payload.scopeType) ||
    !isNonEmptyString(payload.userId) ||
    !isNonEmptyString(payload.windowEnd) ||
    !isNonEmptyString(payload.windowStart)
  ) {
    return;
  }

  return {
    agentId: payload.agentId,
    ...(isNonEmptyString(payload.operationId) ? { operationId: payload.operationId } : {}),
    reason: payload.reason,
    scopeId: payload.scopeId,
    scopeType: payload.scopeType,
    ...(isNonEmptyString(payload.taskId) ? { taskId: payload.taskId } : {}),
    ...(isNonEmptyString(payload.topicId) ? { topicId: payload.topicId } : {}),
    userId: payload.userId,
    windowEnd: payload.windowEnd,
    windowStart: payload.windowStart,
  };
};

const toGuardInput = (
  payload: SelfReflectionSourcePayload,
  source: SourceAgentSelfReflectionRequested,
): SelfReflectionSourceGuardInput => {
  return {
    ...payload,
    guardKey: buildSelfReflectionSourceId({
      agentId: payload.agentId,
      reason: payload.reason,
      scopeId: payload.scopeId,
      scopeType: payload.scopeType,
      userId: payload.userId,
      windowEnd: payload.windowEnd,
      windowStart: payload.windowStart,
    }),
    sourceId: source.sourceId,
  };
};

const toCollectContextInput = (
  payload: SelfReflectionSourcePayload,
): CollectSelfReflectionContextInput => ({
  agentId: payload.agentId,
  ...(payload.operationId ? { operationId: payload.operationId } : {}),
  scopeId: payload.scopeId,
  scopeType: payload.scopeType,
  ...(payload.taskId ? { taskId: payload.taskId } : {}),
  ...(payload.topicId ? { topicId: payload.topicId } : {}),
  userId: payload.userId,
  windowEnd: payload.windowEnd,
  windowStart: payload.windowStart,
});

const toBaseResult = (
  guardInput: SelfReflectionSourceGuardInput,
): Omit<SelfReflectionSourceHandlerResult, 'status'> => ({
  agentId: guardInput.agentId,
  guardKey: guardInput.guardKey,
  scopeId: guardInput.scopeId,
  scopeType: guardInput.scopeType,
  sourceId: guardInput.sourceId,
  userId: guardInput.userId,
  windowEnd: guardInput.windowEnd,
  windowStart: guardInput.windowStart,
});

/**
 * Creates the DI-friendly handler for self-reflection request sources.
 *
 * Triggering workflow:
 *
 * {@link createSelfReflectionSourcePolicyHandler}
 *   -> `agent.self_reflection.requested`
 *     -> {@link createSelfReflectionSourceHandler}
 *
 * The handler validates the request, re-checks gates + idempotency, collects
 * bounded evidence, then enqueues an async `execAgent` run under the builtin
 * `self-reflection` agent (slug `agent-signal-reflection` tools). The run's
 * outcome (memory / skill writes, feedback intents) is projected into receipts
 * by the completion path — this handler does not run the model or write receipts
 * inline.
 *
 * Expects:
 * - `source` is an `agent.self_reflection.requested` source with service-produced payload
 * - Dependencies enforce gates, idempotency, and provide a db handle for dispatch
 *
 * Returns:
 * - A run result with `Dispatched` status + the enqueued operation id, or a
 *   `Skipped` / `Deduped` status when gates / idempotency reject the run
 */
export const createSelfReflectionSourceHandler = (
  deps: CreateSelfReflectionSourceHandlerDependencies,
) => ({
  handle: async (
    source: SourceAgentSelfReflectionRequested,
  ): Promise<SelfReflectionSourceHandlerResult> => {
    const payload = readSelfReflectionPayload(source);

    if (!payload) {
      return {
        reason: 'invalid_payload',
        sourceId: source.sourceId,
        status: ReviewRunStatus.Skipped,
      };
    }

    const guardInput = toGuardInput(payload, source);
    if (source.sourceId !== guardInput.guardKey) {
      return {
        reason: 'invalid_payload',
        sourceId: source.sourceId,
        status: ReviewRunStatus.Skipped,
      };
    }

    const baseResult = toBaseResult(guardInput);

    if (!(await deps.canRunReview(guardInput))) {
      return {
        ...baseResult,
        reason: 'gate_disabled',
        status: ReviewRunStatus.Skipped,
      };
    }

    if (!(await deps.acquireReviewGuard(guardInput))) {
      return {
        ...baseResult,
        status: ReviewRunStatus.Deduped,
      };
    }

    const context = await deps.collectContext(toCollectContextInput(payload));

    const prompt = createAgentSignalSelfIterationPrompt({
      agentId: payload.agentId,
      context,
      mode: 'reflection',
      sourceId: source.sourceId,
      userId: payload.userId,
      window: { end: payload.windowEnd, start: payload.windowStart },
    });

    const dispatch = deps.dispatch ?? enqueueSelfIterationRun;
    const { operationId } = await dispatch({
      agentId: payload.agentId,
      db: deps.db,
      marker: {
        agentId: payload.agentId,
        kind: 'self-reflection',
        sourceId: source.sourceId,
        ...(payload.topicId ? { topicId: payload.topicId } : {}),
      },
      ...(deps.maxSteps ? { maxSteps: deps.maxSteps } : {}),
      prompt,
      slug: BUILTIN_AGENT_SLUGS.selfReflection,
      ...(payload.topicId ? { topicId: payload.topicId } : {}),
      userId: payload.userId,
      workspaceId: deps.workspaceId,
    });

    return {
      ...baseResult,
      operationId,
      status: ReviewRunStatus.Dispatched,
    };
  },
});

/**
 * Creates the runtime source handler definition for self-reflection policy composition.
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `agent.self_reflection.requested`
 *     -> {@link createSelfReflectionSourcePolicyHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with self-reflection dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the dispatch metadata
 */
export const createSelfReflectionSourcePolicyHandler = (
  deps: CreateSelfReflectionSourceHandlerDependencies,
) => {
  const handler = createSelfReflectionSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested}:shared-review`,
    async (source: SourceAgentSelfReflectionRequested) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
