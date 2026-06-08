import type { SourceAgentNightlyReviewRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';
import { createAgentSignalSelfIterationPrompt } from '@lobechat/prompts';
import { isNonEmptyString } from '@lobechat/utils';

import type { LobeChatDatabase } from '@/database/type';

import { defineSourceHandler } from '../../../runtime/middleware';
import { enqueueSelfIterationRun } from '../dispatch/enqueueSelfIterationRun';
import { buildNightlyReviewSourceId, ReviewRunStatus } from '../types';
import type { CollectNightlyReviewContextInput, NightlyReviewContext } from './collect';

/**
 * Validated nightly review request payload consumed by the handler.
 */
export interface NightlyReviewSourcePayload {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** User-local date in YYYY-MM-DD form. */
  localDate: string;
  /** ISO timestamp when the scheduler requested the review. */
  requestedAt: string;
  /** Review window end as an ISO string. */
  reviewWindowEnd: string;
  /** Review window start as an ISO string. */
  reviewWindowStart: string;
  /** IANA timezone used to compute the local nightly window. */
  timezone: string;
  /** Stable user id owning the agent. */
  userId: string;
}

/**
 * Idempotency and gate input shared by nightly review handler dependencies.
 */
export interface NightlyReviewSourceGuardInput extends NightlyReviewSourcePayload {
  /** Stable guard key for one user-agent local date review. */
  guardKey: string;
  /** Normalized source id that triggered the run. */
  sourceId: string;
}

/**
 * Result returned by the nightly review source handler.
 */
export interface NightlyReviewSourceHandlerResult extends Record<string, unknown> {
  /** Stable agent id being reviewed when payload validation succeeds. */
  agentId?: string;
  /** Stable guard key used for idempotency when payload validation succeeds. */
  guardKey?: string;
  /** User-local date in YYYY-MM-DD form when payload validation succeeds. */
  localDate?: string;
  /** Operation id of the enqueued background self-iteration run, when dispatched. */
  operationId?: string;
  /** Machine-readable skip reason for non-dispatched runs. */
  reason?: 'gate_disabled' | 'invalid_payload';
  /** Review window end as an ISO string when payload validation succeeds. */
  reviewWindowEnd?: string;
  /** Review window start as an ISO string when payload validation succeeds. */
  reviewWindowStart?: string;
  /** Source id that triggered the run. */
  sourceId?: string;
  /** Coarse run status for observability and retry semantics. */
  status: ReviewRunStatus;
  /** Stable user id owning the agent when payload validation succeeds. */
  userId?: string;
}

/**
 * Dependencies required by the nightly review source handler.
 */
export interface CreateNightlyReviewSourceHandlerDependencies {
  /** Acquires the per-user-agent local date idempotency guard. */
  acquireReviewGuard: (input: NightlyReviewSourceGuardInput) => Promise<boolean>;
  /** Re-checks runtime gates before doing reviewer work. */
  canRunReview: (input: NightlyReviewSourceGuardInput) => Promise<boolean>;
  /** Collects bounded digest context without mutating shared resources. */
  collectContext: (input: CollectNightlyReviewContextInput) => Promise<NightlyReviewContext>;
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

interface NightlyReviewSpanLike {
  setAttribute: (key: string, value: string | number | boolean) => void;
}

const runNightlyReviewSpan = async <TResult>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  operation: () => Promise<TResult>,
  onSuccess?: (span: NightlyReviewSpanLike, result: TResult) => void,
): Promise<TResult> => {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();

      onSuccess?.(span, result);
      span.setStatus({ code: SpanStatusCode.OK });

      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : `${name} failed`,
      });
      span.recordException(error as Error);

      throw error;
    } finally {
      span.end();
    }
  });
};

const readNightlyReviewPayload = (
  source: SourceAgentNightlyReviewRequested,
): NightlyReviewSourcePayload | undefined => {
  if (source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested) return;

  const payload = source.payload;
  if (
    !isNonEmptyString(payload.agentId) ||
    !isNonEmptyString(payload.localDate) ||
    !isNonEmptyString(payload.requestedAt) ||
    !isNonEmptyString(payload.reviewWindowEnd) ||
    !isNonEmptyString(payload.reviewWindowStart) ||
    !isNonEmptyString(payload.timezone) ||
    !isNonEmptyString(payload.userId)
  ) {
    return;
  }

  return {
    agentId: payload.agentId,
    localDate: payload.localDate,
    requestedAt: payload.requestedAt,
    reviewWindowEnd: payload.reviewWindowEnd,
    reviewWindowStart: payload.reviewWindowStart,
    timezone: payload.timezone,
    userId: payload.userId,
  };
};

const toGuardInput = (
  payload: NightlyReviewSourcePayload,
  source: SourceAgentNightlyReviewRequested,
): NightlyReviewSourceGuardInput => {
  return {
    ...payload,
    guardKey: buildNightlyReviewSourceId({
      agentId: payload.agentId,
      localDate: payload.localDate,
      userId: payload.userId,
    }),
    sourceId: source.sourceId,
  };
};

const toBaseResult = (
  guardInput: NightlyReviewSourceGuardInput,
): Omit<NightlyReviewSourceHandlerResult, 'status'> => ({
  agentId: guardInput.agentId,
  guardKey: guardInput.guardKey,
  localDate: guardInput.localDate,
  reviewWindowEnd: guardInput.reviewWindowEnd,
  reviewWindowStart: guardInput.reviewWindowStart,
  sourceId: guardInput.sourceId,
  userId: guardInput.userId,
});

/**
 * Creates the DI-friendly handler for nightly review request sources.
 *
 * Triggering workflow:
 *
 * {@link createNightlyReviewSourcePolicyHandler}
 *   -> `agent.nightly_review.requested`
 *     -> {@link createNightlyReviewSourceHandler}
 *
 * The handler validates the request, re-checks gates + idempotency, collects the
 * bounded review digest, then enqueues an async `execAgent` run under the builtin
 * `nightly-review` agent. The review window + local date ride on the marker so the
 * builtin `agent-signal-review` serverRuntime can re-derive them; the Daily Brief
 * is written in-run by the review tool primitive, and receipts are projected by
 * the completion path — this handler runs no model and writes no brief/receipts
 * inline.
 *
 * Expects:
 * - `source` is an `agent.nightly_review.requested` source with scheduler-produced payload
 * - Dependencies enforce gates, idempotency, and provide a db handle for dispatch
 *
 * Returns:
 * - A run result with `Dispatched` status + the enqueued operation id, or a
 *   `Skipped` / `Deduped` status when gates / idempotency reject the run
 */
export const createNightlyReviewSourceHandler = (
  deps: CreateNightlyReviewSourceHandlerDependencies,
) => ({
  handle: async (
    source: SourceAgentNightlyReviewRequested,
  ): Promise<NightlyReviewSourceHandlerResult> => {
    return runNightlyReviewSpan(
      'agent_signal.nightly_review.handle',
      {
        'agent.signal.source_id': source.sourceId,
        'agent.signal.source_type': source.sourceType,
      },
      async () => {
        const payload = readNightlyReviewPayload(source);

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

        const canRunReview = await runNightlyReviewSpan(
          'agent_signal.nightly_review.gate',
          {
            'agent.signal.agent_id': payload.agentId,
            'agent.signal.source_id': source.sourceId,
            'agent.signal.user_id': payload.userId,
          },
          () => deps.canRunReview(guardInput),
        );

        if (!canRunReview) {
          return {
            ...baseResult,
            reason: 'gate_disabled',
            status: ReviewRunStatus.Skipped,
          };
        }

        const guardAcquired = await runNightlyReviewSpan(
          'agent_signal.nightly_review.guard',
          {
            'agent.signal.agent_id': payload.agentId,
            'agent.signal.source_id': source.sourceId,
            'agent.signal.user_id': payload.userId,
          },
          () => deps.acquireReviewGuard(guardInput),
        );

        if (!guardAcquired) {
          return {
            ...baseResult,
            status: ReviewRunStatus.Deduped,
          };
        }

        const context = await runNightlyReviewSpan(
          'agent_signal.nightly_review.collect_context',
          {
            'agent.signal.agent_id': payload.agentId,
            'agent.signal.source_id': source.sourceId,
            'agent.signal.user_id': payload.userId,
          },
          () =>
            deps.collectContext({
              agentId: payload.agentId,
              reviewWindowEnd: payload.reviewWindowEnd,
              reviewWindowStart: payload.reviewWindowStart,
              userId: payload.userId,
            }),
          (span, collectedContext) => {
            span.setAttribute(
              'agent.signal.nightly.context_self_review_signal_count',
              collectedContext.selfReviewSignals?.length ?? 0,
            );
            span.setAttribute(
              'agent.signal.nightly.context_tool_activity_count',
              collectedContext.toolActivity?.length ?? 0,
            );
            span.setAttribute(
              'agent.signal.nightly.context_document_skill_event_count',
              collectedContext.documentActivity?.skillBucket?.length ?? 0,
            );
          },
        );

        const prompt = createAgentSignalSelfIterationPrompt({
          agentId: payload.agentId,
          context,
          mode: 'review',
          sourceId: source.sourceId,
          userId: payload.userId,
          window: {
            end: payload.reviewWindowEnd,
            localDate: payload.localDate,
            start: payload.reviewWindowStart,
            timezone: payload.timezone,
          },
        });

        const { operationId } = await runNightlyReviewSpan(
          'agent_signal.nightly_review.dispatch',
          {
            'agent.signal.agent_id': payload.agentId,
            'agent.signal.source_id': source.sourceId,
            'agent.signal.user_id': payload.userId,
          },
          () => {
            const dispatch = deps.dispatch ?? enqueueSelfIterationRun;

            return dispatch({
              agentId: payload.agentId,
              db: deps.db,
              marker: {
                agentId: payload.agentId,
                kind: 'nightly-review',
                localDate: payload.localDate,
                reviewWindowEnd: payload.reviewWindowEnd,
                reviewWindowStart: payload.reviewWindowStart,
                sourceId: source.sourceId,
              },
              ...(deps.maxSteps ? { maxSteps: deps.maxSteps } : {}),
              prompt,
              slug: BUILTIN_AGENT_SLUGS.nightlyReview,
              userId: payload.userId,
              workspaceId: deps.workspaceId,
            });
          },
          (span, result) => {
            span.setAttribute('agent.signal.nightly.operation_id', result.operationId);
          },
        );

        return {
          ...baseResult,
          operationId,
          status: ReviewRunStatus.Dispatched,
        };
      },
    );
  },
});

/**
 * Creates the runtime source handler definition for nightly review policy composition.
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `agent.nightly_review.requested`
 *     -> {@link createNightlyReviewSourcePolicyHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with nightly review dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the dispatch metadata
 */
export const createNightlyReviewSourcePolicyHandler = (
  deps: CreateNightlyReviewSourceHandlerDependencies,
) => {
  const handler = createNightlyReviewSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested}:shared-review`,
    async (source: SourceAgentNightlyReviewRequested) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
