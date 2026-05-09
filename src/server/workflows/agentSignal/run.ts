import type {
  AgentSignalSourceEvent,
  SourceEventAgentUserMessage,
} from '@lobechat/agent-signal/source';
import {
  AGENT_SIGNAL_SOURCE_TYPES,
  isAgentUserMessageSource,
  isClientRuntimeStartSource,
  isNightlyReviewSource,
  isSelfIterationIntentSource,
  isSelfReflectionSource,
  isToolOutcomeSource,
} from '@lobechat/agent-signal/source';
import type { ExecutionSnapshot, ISnapshotStore, StepSnapshot } from '@lobechat/agent-tracing';
import { messages } from '@lobechat/database/schemas';
import { context as otContext, SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  tracer,
  workflowRunCounter,
  workflowRunDurationHistogram,
} from '@lobechat/observability-otel/modules/agent-signal';
import { attributesCommon } from '@lobechat/observability-otel/node';
import debug from 'debug';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { getServerDB } from '@/database/server';
import { extractTraceContext } from '@/libs/observability/traceparent';
import { isAgentSignalEnabledForUser } from '@/server/services/agentSignal/featureGate';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';
import type { GeneratedAgentSignalEmissionResult } from '@/server/services/agentSignal/orchestrator';
import { executeAgentSignalSourceEvent } from '@/server/services/agentSignal/orchestrator';
import { assembleFeedbackContext } from '@/server/services/agentSignal/policies/analyzeIntent/context/feedbackContextAssembler';
import { createRedisRuntimeGuardBackend } from '@/server/services/agentSignal/runtime/backend/redisGuard';
import {
  createServerNightlyReviewPolicyOptions,
  createServerProcedurePolicyOptions,
  createServerSelfIterationIntentPolicyOptions,
  createServerSelfReflectionPolicyOptions,
} from '@/server/services/agentSignal/services/maintenance/serverRuntime';
import type { ClientRuntimeCompleteHydrationDiagnostic } from '@/server/services/agentSignal/sources/hydration/clientRuntimeComplete';
import { resolveClientRuntimeCompleteFeedbackSource } from '@/server/services/agentSignal/sources/hydration/clientRuntimeComplete';
import type { ClientRuntimeStartHydrationDiagnostic } from '@/server/services/agentSignal/sources/hydration/clientRuntimeStart';
import { resolveClientRuntimeStartFeedbackSource } from '@/server/services/agentSignal/sources/hydration/clientRuntimeStart';

import type { AgentSignalWorkflowRunPayload } from './types';

const log = debug('lobe-server:workflows:agent-signal:run');

type WorkflowHydrationDiagnostic =
  | ClientRuntimeCompleteHydrationDiagnostic
  | (ClientRuntimeStartHydrationDiagnostic & {
      kind: typeof AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart;
    });

const isGeneratedEmission = (
  value: Awaited<ReturnType<typeof executeAgentSignalSourceEvent>> | undefined,
): value is GeneratedAgentSignalEmissionResult => {
  return Boolean(value && !value.deduped);
};

const isClientRuntimeCompleteSource = (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
): sourceEvent is AgentSignalSourceEvent<
  typeof AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete
> => {
  return sourceEvent.sourceType === AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete;
};

/**
 * Minimal workflow context contract used by the Agent Signal workflow runner.
 *
 * @param TPayload - Workflow request payload type.
 */
export interface AgentSignalWorkflowContext<TPayload = AgentSignalWorkflowRunPayload> {
  headers?: Headers;
  requestPayload?: TPayload;
  run: <TResult>(stepId: string, handler: () => Promise<TResult>) => Promise<TResult>;
}

/** Dependencies for executing one Agent Signal workflow payload. */
export interface RunAgentSignalWorkflowDeps {
  createNightlyReviewPolicyOptions?: typeof createServerNightlyReviewPolicyOptions;
  createProcedurePolicyOptions?: typeof createServerProcedurePolicyOptions;
  createRuntimeGuardBackend?: typeof createRedisRuntimeGuardBackend;
  createSelfIterationIntentPolicyOptions?: typeof createServerSelfIterationIntentPolicyOptions;
  createSelfReflectionPolicyOptions?: typeof createServerSelfReflectionPolicyOptions;
  createSnapshotStore?: () => ISnapshotStore | null;
  executeSourceEvent?: typeof executeAgentSignalSourceEvent;
  getDb?: typeof getServerDB;
}

const buildWorkflowMetricAttributes = (
  sourceType: string,
  status: 'error' | 'generated' | 'invalid_payload' | 'no_emission',
) => ({
  'agent.signal.source_type': sourceType,
  'agent.signal.workflow_status': status,
  ...attributesCommon(),
});

const createDefaultSnapshotStore = (): ISnapshotStore | null => {
  if (process.env.NODE_ENV !== 'development') return null;

  try {
    // NOTICE:
    // Workflow-triggered Agent Signal runs do not pass through AgentRuntimeService.executeStep(),
    // so they never hit the normal dev snapshot recorder path. We lazily require the file-backed
    // store here to bridge those workflow-only runs into `.agent-tracing/` for local debugging.
    // Removal condition:
    // - Safe to remove only if workflow executions share the same snapshot recorder as executeStep.
    // Source/context:
    // - `AgentRuntimeService` records `agent_signal.*` events into step snapshots.
    // - `runAgentSignalWorkflow` only persisted OTel observability before this bridge.
    // - `agent-tracing inspect -S` therefore showed zero events for workflow-triggered runs.

    const { FileSnapshotStore } = require('@lobechat/agent-tracing');
    return new FileSnapshotStore();
  } catch {
    return null;
  }
};

const resolveSnapshotOperationId = (result: GeneratedAgentSignalEmissionResult) => {
  const payloadOperationId =
    typeof result.source.payload === 'object' &&
    result.source.payload !== null &&
    'operationId' in result.source.payload &&
    typeof result.source.payload.operationId === 'string'
      ? result.source.payload.operationId
      : undefined;

  return payloadOperationId ?? result.source.sourceId;
};

const toWorkflowStepSnapshot = (result: GeneratedAgentSignalEmissionResult): StepSnapshot => {
  const events = toAgentSignalTraceEvents({
    actions: result.orchestration.actions,
    results: result.orchestration.results,
    signals: result.orchestration.emittedSignals,
    source: result.source,
  });
  const startedAt = result.source.timestamp;
  const completedAt =
    Math.max(
      startedAt,
      ...events
        .map((event) => event.timestamp)
        .filter((timestamp): timestamp is number => typeof timestamp === 'number'),
    ) || startedAt;

  return {
    completedAt,
    context: {
      payload: {
        scopeKey: result.source.scopeKey,
        sourceId: result.source.sourceId,
        sourceType: result.source.sourceType,
      },
      phase: 'agent_signal_workflow',
    },
    events,
    executionTimeMs: Math.max(0, completedAt - startedAt),
    startedAt,
    stepIndex: 0,
    stepType: 'call_tool',
    totalCost: 0,
    totalTokens: 0,
  };
};

const persistWorkflowSnapshot = async (
  result: GeneratedAgentSignalEmissionResult,
  store: ISnapshotStore,
  userId: string,
) => {
  const operationId = resolveSnapshotOperationId(result);
  const step = toWorkflowStepSnapshot(result);
  const snapshot: ExecutionSnapshot = {
    agentId:
      typeof result.source.payload === 'object' &&
      result.source.payload !== null &&
      'agentId' in result.source.payload &&
      typeof result.source.payload.agentId === 'string'
        ? result.source.payload.agentId
        : undefined,
    completedAt: step.completedAt,
    completionReason: 'done',
    operationId,
    startedAt: step.startedAt,
    steps: [step],
    topicId:
      typeof result.source.payload === 'object' &&
      result.source.payload !== null &&
      'topicId' in result.source.payload &&
      typeof result.source.payload.topicId === 'string'
        ? result.source.payload.topicId
        : undefined,
    totalCost: 0,
    totalSteps: 1,
    totalTokens: 0,
    traceId: operationId,
    userId,
  };

  await store.save(snapshot);
};

const readSourcePayloadString = (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
  field: string,
): string | undefined => {
  const payload = sourceEvent.payload;

  return typeof payload === 'object' &&
    payload !== null &&
    field in payload &&
    typeof payload[field as keyof typeof payload] === 'string'
    ? payload[field as keyof typeof payload]
    : undefined;
};

const persistWorkflowHydrationSkippedSnapshot = async (
  input: {
    hydration: WorkflowHydrationDiagnostic;
    sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'];
    userId: string;
  },
  store: ISnapshotStore,
) => {
  const startedAt = input.sourceEvent.timestamp;
  const completedAt = Date.now();
  const operationId =
    readSourcePayloadString(input.sourceEvent, 'operationId') ?? input.sourceEvent.sourceId;
  const step: StepSnapshot = {
    completedAt,
    context: {
      payload: {
        hydration: input.hydration,
        scopeKey: input.sourceEvent.scopeKey,
        sourceId: input.sourceEvent.sourceId,
        sourceType: input.sourceEvent.sourceType,
      },
      phase: 'agent_signal_workflow',
    },
    events: [
      {
        data: {
          hydrationKind: input.hydration.kind,
          hydrationReason: input.hydration.reason,
          hydrationStatus: input.hydration.status,
          scopeKey: input.sourceEvent.scopeKey,
          sourceId: input.sourceEvent.sourceId,
          sourceType: input.sourceEvent.sourceType,
        },
        timestamp: completedAt,
        type: 'agent_signal.workflow.hydration',
      },
    ],
    executionTimeMs: Math.max(0, completedAt - startedAt),
    startedAt,
    stepIndex: 0,
    stepType: 'call_tool',
    totalCost: 0,
    totalTokens: 0,
  };

  await store.save({
    agentId: readSourcePayloadString(input.sourceEvent, 'agentId'),
    completedAt,
    completionReason: 'done',
    operationId,
    startedAt,
    steps: [step],
    topicId: readSourcePayloadString(input.sourceEvent, 'topicId'),
    totalCost: 0,
    totalSteps: 1,
    totalTokens: 0,
    traceId: operationId,
    userId: input.userId,
  });
};

const buildFeedbackSourceSerializedContext = async (
  sourceEvent: SourceEventAgentUserMessage,
  input: { contextEndAt?: Date; db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<string | undefined> => {
  if (typeof sourceEvent.payload.serializedContext === 'string') {
    return sourceEvent.payload.serializedContext;
  }

  if (typeof sourceEvent.payload.topicId !== 'string') return undefined;

  const messageModel = new MessageModel(input.db, input.userId);
  const anchorMessage = await messageModel.findById(sourceEvent.payload.messageId);

  if (!anchorMessage?.createdAt) return undefined;

  const contextEndAt = input.contextEndAt ?? anchorMessage.createdAt;
  const threadScopeFilter =
    typeof sourceEvent.payload.threadId === 'string'
      ? eq(messages.threadId, sourceEvent.payload.threadId)
      : isNull(messages.threadId);

  const recentMessages = await input.db.query.messages.findMany({
    limit: 10,
    orderBy: [desc(messages.createdAt)],
    where: and(
      eq(messages.userId, input.userId),
      eq(messages.topicId, sourceEvent.payload.topicId),
      lte(messages.createdAt, contextEndAt),
      threadScopeFilter,
    ),
  });

  // TODO: serialize recent tool calls / tool results into feedback analysis context when we finalize the context format.
  return assembleFeedbackContext({
    feedbackMessage: {
      content: sourceEvent.payload.message,
      id: sourceEvent.payload.messageId,
      role: 'user',
    },
    messages: [...recentMessages]
      .reverse()
      .map((message) => ({ content: message.content, id: message.id, role: message.role })),
  }).serializedContext;
};

const enrichFeedbackSourceSerializedContext = async (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
  input: { contextEndAt?: Date; db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<AgentSignalWorkflowRunPayload['sourceEvent']> => {
  if (!isAgentUserMessageSource(sourceEvent)) return sourceEvent;

  const serializedContext = await buildFeedbackSourceSerializedContext(sourceEvent, input);

  if (typeof serializedContext !== 'string') return sourceEvent;

  return {
    ...sourceEvent,
    payload: {
      ...sourceEvent.payload,
      serializedContext,
    },
  };
};

/**
 * Normalizes one workflow source event into the runtime-facing source catalog.
 *
 * Use when:
 * - Workflow ingress receives browser lifecycle events
 * - Downstream policies expect richer server-owned sources such as `agent.user.message`
 *
 * Expects:
 * - `db` and `userId` point at the same message store used by the originating chat session
 *
 * Returns:
 * - The hydrated source when a client lifecycle event can be resolved
 * - Otherwise the original workflow source event
 *
 * Call stack:
 *
 * {@link runAgentSignalWorkflow}
 *   -> {@link normalizeWorkflowSourceEvent}
 *     -> {@link resolveClientRuntimeCompleteFeedbackSource}
 *       -> {@link MessageModel.findById}
 *     -> {@link resolveClientRuntimeStartFeedbackSource}
 *       -> {@link MessageModel.findById}
 */
const normalizeWorkflowSourceEvent = async (
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'],
  input: { db: Awaited<ReturnType<typeof getServerDB>>; userId: string },
): Promise<{
  hydration?: WorkflowHydrationDiagnostic;
  sourceEvent: AgentSignalWorkflowRunPayload['sourceEvent'];
}> => {
  if (isClientRuntimeCompleteSource(sourceEvent)) {
    const hydration = await resolveClientRuntimeCompleteFeedbackSource(sourceEvent, input);
    const hydratedSourceEvent = hydration.source ?? sourceEvent;

    return {
      hydration: hydration.diagnostic,
      sourceEvent: await enrichFeedbackSourceSerializedContext(hydratedSourceEvent, {
        ...input,
        contextEndAt: hydration.contextEndAt,
      }),
    };
  }

  if (isClientRuntimeStartSource(sourceEvent)) {
    const hydration = await resolveClientRuntimeStartFeedbackSource(sourceEvent, input);
    const hydratedSourceEvent = hydration.source ?? sourceEvent;

    return {
      hydration: {
        ...hydration.diagnostic,
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
      },
      sourceEvent: await enrichFeedbackSourceSerializedContext(hydratedSourceEvent, input),
    };
  }

  return { sourceEvent: await enrichFeedbackSourceSerializedContext(sourceEvent, input) };
};

/**
 * Runs one normalized Agent Signal source event inside the workflow worker.
 *
 * Use when:
 * - The Next.js Upstash route needs a plain function for testable execution
 * - Tests or local harnesses need the exact workflow worker logic without HTTP indirection
 *
 * Expects:
 * - `context.requestPayload` contains `userId` and one normalized `sourceEvent`
 *
 * Returns:
 * - A small execution summary mirroring the workflow route response
 *
 * Search spans:
 * - `agent_signal.workflow.run`
 * - `agent_signal.workflow.normalize`
 * - `agent_signal.workflow.execute`
 *
 * Expected attributes:
 * - `agent.signal.scope_key`
 * - `agent.signal.source_id`
 * - `agent.signal.source_type`
 * - `agent.signal.emitted_signal_count` after execution
 * - `agent.signal.workflow_deduped` after execution
 *
 * Expected events:
 * - none; this boundary currently models phases as nested spans instead of events
 *
 * Expected metrics:
 * - `agent_signal_workflow_runs_total`
 * - `agent_signal_workflow_duration_ms`
 *
 * Metric attributes:
 * - `agent.signal.source_type`
 * - `agent.signal.workflow_status`: `generated | no_emission | invalid_payload | error`
 *
 * Failure modes:
 * - Marks the top-level span as `ERROR` for invalid payloads
 * - Marks nested spans as `ERROR` when normalize or execute fails
 * - Re-throws execution failures after recording workflow metrics
 */
export const runAgentSignalWorkflow = async (
  context: AgentSignalWorkflowContext,
  deps: RunAgentSignalWorkflowDeps = {},
) => {
  const payload = context.requestPayload;
  const sourceType = payload?.sourceEvent?.sourceType ?? 'unknown';
  const startedAt = Date.now();
  // NOTICE:
  // Upstash Workflow Hono handlers do not flow through our regular backend auth middleware, so
  // the usual request-level trace-context extraction does not happen automatically here.
  // We must extract `traceparent` / `tracestate` from the workflow request headers manually before
  // opening the top-level workflow span, otherwise each workflow run starts a fresh trace.
  // Source/context:
  // - `src/app/(backend)/middleware/auth/index.ts` performs extract/inject for normal backend APIs
  // - `src/server/workflows-hono/agent-signal/index.ts` wires `serve(...)` directly to
  //   `runAgentSignalWorkflow(...)`
  // Removal condition:
  // - Safe to remove only if the workflow entry stack gains a shared request middleware that
  //   guarantees OTEL context extraction before invoking workflow handlers.
  const traceContext = context.headers ? extractTraceContext(context.headers) : otContext.active();

  return otContext.with(traceContext, () =>
    tracer.startActiveSpan(
      'agent_signal.workflow.run',
      {
        attributes: {
          'agent.signal.scope_key': payload?.sourceEvent?.scopeKey,
          'agent.signal.source_id': payload?.sourceEvent?.sourceId,
          'agent.signal.source_type': sourceType,
        },
      },
      async (span) => {
        let workflowStatus: 'error' | 'generated' | 'invalid_payload' | 'no_emission' | undefined;

        try {
          if (!payload?.userId || !payload.sourceEvent) {
            workflowStatus = 'invalid_payload';
            workflowRunCounter.add(1, buildWorkflowMetricAttributes(sourceType, workflowStatus));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Missing userId or sourceEvent',
            });

            return { error: 'Missing userId or sourceEvent', success: false } as const;
          }

          log('Worker received payload=%O', payload);

          const getDb = deps.getDb ?? getServerDB;
          const executeSourceEvent = deps.executeSourceEvent ?? executeAgentSignalSourceEvent;
          const createNightlyReviewPolicyOptions =
            deps.createNightlyReviewPolicyOptions ?? createServerNightlyReviewPolicyOptions;
          const createSelfReflectionPolicyOptions =
            deps.createSelfReflectionPolicyOptions ?? createServerSelfReflectionPolicyOptions;
          const createSelfIterationIntentPolicyOptions =
            deps.createSelfIterationIntentPolicyOptions ??
            createServerSelfIterationIntentPolicyOptions;
          const createProcedurePolicyOptions =
            deps.createProcedurePolicyOptions ?? createServerProcedurePolicyOptions;
          const createGuardBackend =
            deps.createRuntimeGuardBackend ?? createRedisRuntimeGuardBackend;
          const snapshotStore = (deps.createSnapshotStore ?? createDefaultSnapshotStore)();
          let hydrationDiagnostic: WorkflowHydrationDiagnostic | undefined;
          let selfIterationEnabled = false;

          const db = await getDb();
          const normalizedSourceEvent = await tracer.startActiveSpan(
            'agent_signal.workflow.normalize',
            async (normalizeSpan) => {
              try {
                selfIterationEnabled = await isAgentSignalEnabledForUser(db, payload.userId);
                const result = await normalizeWorkflowSourceEvent(payload.sourceEvent, {
                  db,
                  userId: payload.userId,
                });
                if (result.hydration) {
                  hydrationDiagnostic = result.hydration;
                  normalizeSpan.setAttribute(
                    'agent.signal.hydration.status',
                    result.hydration.status,
                  );
                  if (result.hydration.kind) {
                    normalizeSpan.setAttribute(
                      'agent.signal.hydration.kind',
                      result.hydration.kind,
                    );
                  }
                  if (result.hydration.reason) {
                    normalizeSpan.setAttribute(
                      'agent.signal.hydration.reason',
                      result.hydration.reason,
                    );
                  }
                }
                normalizeSpan.setStatus({ code: SpanStatusCode.OK });

                return result.sourceEvent;
              } catch (error) {
                normalizeSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message:
                    error instanceof Error
                      ? error.message
                      : 'AgentSignal workflow normalize failed',
                });
                normalizeSpan.recordException(error as Error);
                throw error;
              } finally {
                normalizeSpan.end();
              }
            },
          );
          const result = await tracer.startActiveSpan(
            'agent_signal.workflow.execute',
            async (executeSpan) => {
              try {
                const nightlyReview = isNightlyReviewSource(normalizedSourceEvent)
                  ? createNightlyReviewPolicyOptions({
                      agentId: payload.agentId,
                      db,
                      selfIterationEnabled,
                      userId: payload.userId,
                    })
                  : undefined;
                const selfReflection = isSelfReflectionSource(normalizedSourceEvent)
                  ? createSelfReflectionPolicyOptions({
                      agentId: payload.agentId,
                      db,
                      selfIterationEnabled,
                      userId: payload.userId,
                    })
                  : undefined;
                const selfIterationIntent = isSelfIterationIntentSource(normalizedSourceEvent)
                  ? createSelfIterationIntentPolicyOptions({
                      agentId: payload.agentId,
                      db,
                      selfIterationEnabled,
                      userId: payload.userId,
                    })
                  : undefined;
                const procedure = isToolOutcomeSource(normalizedSourceEvent)
                  ? createProcedurePolicyOptions({
                      agentId: payload.agentId,
                      db,
                      selfIterationEnabled,
                      userId: payload.userId,
                    })
                  : undefined;
                const executionResult = await context.run(
                  `agent-signal:execute:${normalizedSourceEvent.sourceType}:${normalizedSourceEvent.sourceId}`,
                  () =>
                    executeSourceEvent(
                      normalizedSourceEvent,
                      {
                        agentId: payload.agentId,
                        db,
                        userId: payload.userId,
                      },
                      {
                        policyOptions: {
                          ...(nightlyReview ? { nightlyReview } : {}),
                          ...(procedure ? { procedure } : {}),
                          ...(selfIterationIntent ? { selfIterationIntent } : {}),
                          ...(selfReflection ? { selfReflection } : {}),
                          skillManagement: {
                            selfIterationEnabled,
                          },
                        },
                        runtimeGuardBackend: createGuardBackend(),
                      },
                    ),
                );
                executeSpan.setStatus({ code: SpanStatusCode.OK });

                return executionResult;
              } catch (error) {
                executeSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message:
                    error instanceof Error ? error.message : 'AgentSignal workflow execute failed',
                });
                executeSpan.recordException(error as Error);
                throw error;
              } finally {
                executeSpan.end();
              }
            },
          );

          workflowStatus = isGeneratedEmission(result) ? 'generated' : 'no_emission';

          log('Processed source event result=%O', {
            deduped: result?.deduped ?? true,
            orchestration:
              result && !result.deduped
                ? {
                    actionTypes: result.orchestration.actions.map((action) => action.actionType),
                    resultStatuses: result.orchestration.results.map((item) => item.status),
                    runtimeStatus:
                      'runtimeResult' in result.orchestration
                        ? result.orchestration.runtimeResult.status
                        : undefined,
                    signalTypes: result.orchestration.emittedSignals.map(
                      (signal) => signal.signalType,
                    ),
                  }
                : undefined,
            scopeKey: payload.sourceEvent.scopeKey,
            sourceId: normalizedSourceEvent.sourceId,
            sourceType: normalizedSourceEvent.sourceType,
          });

          if (snapshotStore && isGeneratedEmission(result)) {
            try {
              await persistWorkflowSnapshot(result, snapshotStore, payload.userId);
            } catch (error) {
              log('Persist workflow snapshot failed error=%O', error);
            }
          }

          if (
            snapshotStore &&
            !isGeneratedEmission(result) &&
            hydrationDiagnostic?.status === 'skipped'
          ) {
            try {
              await persistWorkflowHydrationSkippedSnapshot(
                {
                  hydration: hydrationDiagnostic,
                  sourceEvent: payload.sourceEvent,
                  userId: payload.userId,
                },
                snapshotStore,
              );
            } catch (error) {
              log('Persist workflow hydration skipped snapshot failed error=%O', error);
            }
          }

          workflowRunCounter.add(
            1,
            buildWorkflowMetricAttributes(normalizedSourceEvent.sourceType, workflowStatus),
          );
          span.setAttribute(
            'agent.signal.emitted_signal_count',
            isGeneratedEmission(result) ? result.orchestration.emittedSignals.length : 0,
          );
          span.setAttribute('agent.signal.workflow_deduped', result?.deduped ?? true);
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            deduped: result?.deduped ?? true,
            emittedSignals: isGeneratedEmission(result)
              ? result.orchestration.emittedSignals.length
              : 0,
            scopeKey: normalizedSourceEvent.scopeKey,
            sourceId: normalizedSourceEvent.sourceId,
            success: true,
          } as const;
        } catch (error) {
          workflowStatus = 'error';
          workflowRunCounter.add(1, buildWorkflowMetricAttributes(sourceType, workflowStatus));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'AgentSignal workflow run failed',
          });
          span.recordException(error as Error);
          throw error;
        } finally {
          workflowRunDurationHistogram.record(
            Date.now() - startedAt,
            buildWorkflowMetricAttributes(sourceType, workflowStatus ?? 'no_emission'),
          );
          span.end();
        }
      },
    ),
  );
};
