import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import {
  createDurableSelfReflectionAccumulator,
  createProcedurePolicyOptions,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';

import { createSelfReflectionService } from '../../selfReflection';
import type { CreateServerSelfIterationPolicyOptions } from '../server';
import { canRunSelfIterationSource } from '../server';
import type {
  CollectSelfReflectionContextInput,
  CreateSelfReflectionSourceHandlerDependencies,
  SelfReflectionReviewContext,
} from './handler';

const collectSelfReflectionContext = async (
  reviewContextModel: AgentSignalReviewContextModel,
  input: CollectSelfReflectionContextInput,
): Promise<SelfReflectionReviewContext> => {
  const topicIds =
    input.scopeType === 'topic' || input.topicId
      ? [input.topicId ?? input.scopeId].filter((value): value is string => Boolean(value))
      : [];
  const rows = topicIds.length
    ? await reviewContextModel.listSelfReflectionTopicActivity({
        agentId: input.agentId,
        topicId: topicIds[0],
        windowEnd: new Date(input.windowEnd),
        windowStart: new Date(input.windowStart),
      })
    : [];

  return {
    ...input,
    evidenceRefs: [
      {
        id: input.scopeId,
        type: input.scopeType,
      },
    ],
    topics: rows.map((row) => ({
      evidenceRefs: row.topicId ? [{ id: row.topicId, type: 'topic' }] : [],
      failedToolCount: row.failedToolCount,
      failureCount: row.failureCount,
      lastActivityAt: row.lastActivityAt?.toISOString(),
      messageCount: row.messageCount,
      summary: row.summary,
      title: row.title ?? undefined,
      topicId: row.topicId ?? undefined,
    })),
  };
};

/**
 * Creates server self-reflection policy options for the Agent Signal workflow.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerSelfReflectionPolicyOptions}
 *     -> reflection source handler dependencies
 *       -> {@link enqueueSelfIterationRun} (async execAgent under the builtin slug)
 *
 * The handler only gates, dedupes, collects bounded evidence, and dispatches an
 * async run. The self-iteration tools (resource skill/memory writes + artifact
 * recorders) are resolved server-side from `plugins: ['agent-signal-reflection']`
 * by the builtin self-reflection agent's serverRuntime — there is no inline
 * model runtime, toolset, or receipt writer here anymore.
 *
 * Expects:
 * - The source was emitted by the self-reflection request service
 * - The handler will re-check gates and idempotency before dispatch
 *
 * Returns:
 * - Self-reflection handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerSelfReflectionPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
  workspaceId,
}: CreateServerSelfIterationPolicyOptions): CreateSelfReflectionSourceHandlerDependencies => {
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId, workspaceId);

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `self-reflection-guard:${input.guardKey}`,
        AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds,
      ),
    canRunReview: async (input) => {
      if (input.userId !== userId) return false;

      return canRunSelfIterationSource({
        agentId: input.agentId,
        expectedAgentId: agentId,
        reviewContextModel,
        selfIterationEnabled,
      });
    },
    collectContext: (input) => collectSelfReflectionContext(reviewContextModel, input),
    db,
    workspaceId,
  };
};

/**
 * Creates server procedure policy options with fast-loop self-reflection enabled.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerProcedurePolicyOptions}
 *     -> {@link createProcedurePolicyOptions}
 *       -> durable weak-signal self-reflection accumulator
 *
 * Use when:
 * - Workflow-owned Agent Signal runtimes process tool outcome sources
 * - Repeated tool failures should enqueue scoped self-reflection request sources
 *
 * Expects:
 * - The same Redis policy-state store is shared with procedure records and accumulators
 * - Feature gates are re-checked before the request source is enqueued
 *
 * Returns:
 * - Procedure policy options ready for procedure-aware Agent Signal policies
 */
export const createServerProcedurePolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
  workspaceId,
}: CreateServerSelfIterationPolicyOptions) => {
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId, workspaceId);

  return createProcedurePolicyOptions({
    policyStateStore: redisPolicyStateStore,
    selfReflection: {
      accumulator: createDurableSelfReflectionAccumulator({
        policyStateStore: redisPolicyStateStore,
        ttlSeconds: 7 * 24 * 60 * 60,
      }),
      getWindowStart: ({ decision, source }) =>
        decision.windowStart ?? new Date(source.timestamp).toISOString(),
      service: createSelfReflectionService({
        canRequestSelfReflection: async (input) => {
          if (input.userId !== userId) return false;

          return canRunSelfIterationSource({
            agentId: input.agentId,
            expectedAgentId: agentId,
            reviewContextModel,
            selfIterationEnabled,
          });
        },
        enqueueSource: async (event) => {
          // Lazy-loaded on purpose: importing `emitter` statically here pulls the
          // agentSignal source/orchestrator graph into the self-iteration module at
          // load time, which both couples the heavy execution core and breaks the
          // `vi.resetModules()` re-mock boundary the integration tests rely on.
          const { enqueueAgentSignalSourceEvent } =
            await import('@/server/services/agentSignal/emitter');

          return enqueueAgentSignalSourceEvent(event, {
            agentId,
            userId,
            workspaceId,
          });
        },
      }),
      userId,
    },
    ttlSeconds: 7 * 24 * 60 * 60,
  });
};
