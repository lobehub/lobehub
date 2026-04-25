import type {
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  DedupedSourceEventResult,
  ExecutorResult,
  GeneratedSourceEventResult,
  SignalPlan,
} from '@lobechat/agent-signal';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import type { LobeChatDatabase } from '@/database/type';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { AgentSignalWorkflow } from '@/server/workflows/agentSignal';

import { isAgentSignalEnabledForUser } from './featureGate';
import { projectAgentSignalObservability } from './observability/projector';
import { persistAgentSignalObservability } from './observability/store';
import { createDefaultAgentSignalPolicies } from './policies/groups/default';
import type { RuntimeGuardBackend } from './runtime/AgentSignalRuntime';
import { createAgentSignalRuntime } from './runtime/AgentSignalRuntime';
import { AgentSignalScopeKey } from './scopeKey';
import type { EmitSourceEventInput } from './sources';
import { emitSourceEvent } from './sources';
import type {
  AgentSignalSourcePayloadMap,
  AgentSignalSourceType,
  SourceAgentExecutionCompleted,
  SourceAgentExecutionFailed,
  SourceAgentUserMessage,
  SourceBotMessageMerged,
  SourceRuntimeAfterStep,
  SourceRuntimeBeforeStep,
} from './sourceTypes';
import type { AgentSignalSourceEventStore } from './store/types';

export { createAgentSignalRuntime } from './runtime/AgentSignalRuntime';

const log = debug('lobe-server:agent-signal:service');

export interface AgentSignalExecutionContext {
  agentId?: string;
  db: LobeChatDatabase;
  userId: string;
}

type RuntimeProducerSourceType =
  | SourceAgentExecutionCompleted['sourceType']
  | SourceAgentExecutionFailed['sourceType']
  | SourceRuntimeAfterStep['sourceType']
  | SourceRuntimeBeforeStep['sourceType'];

type AgentSignalSourcePayload<TSourceType extends AgentSignalSourceType> =
  AgentSignalSourcePayloadMap[TSourceType];

/** One producer-side source emission input. */
export interface AgentSignalSourceEventInput<
  TSourceType extends AgentSignalSourceType,
> extends Omit<EmitSourceEventInput, 'payload' | 'scopeKey' | 'sourceType' | 'timestamp'> {
  payload: AgentSignalSourcePayload<TSourceType>;
  scopeKey?: string;
  sourceType: TSourceType;
  timestamp?: number;
}

/** One AgentSignal emission execution option set. */
export interface AgentSignalEmitOptions {
  ignoreError?: boolean;
}

/** One AgentSignal async handoff result. */
export interface QueuedAgentSignalEmissionResult {
  accepted: boolean;
  scopeKey: string;
  workflowRunId: string;
}

interface ExecuteAgentSignalSourceEventOptions extends AgentSignalEmitOptions {
  runtimeGuardBackend?: RuntimeGuardBackend;
  store?: AgentSignalSourceEventStore;
}

export type RuntimeAgentSignalSourceInput<TSourceType extends RuntimeProducerSourceType> =
  AgentSignalSourceEventInput<TSourceType>;

export type BotAgentSignalSourceInput = AgentSignalSourceEventInput<
  SourceBotMessageMerged['sourceType']
>;

export type UserMessageAgentSignalSourceInput = AgentSignalSourceEventInput<
  SourceAgentUserMessage['sourceType']
>;

export type AgentSignalSourceEnvelope = AgentSignalSourceEventInput<AgentSignalSourceType>;

const createEmptyRuntimeTrace = (source: AgentSignalSource) => {
  return {
    actions: [] as BaseAction[],
    results: [],
    signals: [] as BaseSignal[],
    source,
  };
};

export interface AgentSignalEmissionOrchestration {
  actions: BaseAction[];
  emittedSignals: BaseSignal[];
  observability: Awaited<ReturnType<typeof projectAgentSignalObservability>>;
  plans: SignalPlan[];
  results: ExecutorResult[];
}

export interface RuntimeBackedAgentSignalEmissionOrchestration extends AgentSignalEmissionOrchestration {
  runtimeResult: Awaited<
    ReturnType<Awaited<ReturnType<typeof createAgentSignalRuntime>>['emitNormalized']>
  >;
}

export interface GeneratedAgentSignalEmissionResult {
  deduped: false;
  orchestration: AgentSignalEmissionOrchestration | RuntimeBackedAgentSignalEmissionOrchestration;
  source: AgentSignalSource;
  trigger: GeneratedSourceEventResult['trigger'];
}

const buildRuntimeOrchestrationResult = (
  source: AgentSignalSource,
  runtimeResult: Awaited<
    ReturnType<Awaited<ReturnType<typeof createAgentSignalRuntime>>['emitNormalized']>
  >,
): RuntimeBackedAgentSignalEmissionOrchestration => {
  const trace =
    runtimeResult.status === 'completed' ? runtimeResult.trace : createEmptyRuntimeTrace(source);
  const observability = projectAgentSignalObservability({
    actions: trace.actions,
    results: trace.results,
    signals: trace.signals,
    source: trace.source,
  });

  return {
    actions: trace.actions,
    emittedSignals: trace.signals,
    observability,
    plans: [],
    results: trace.results,
    runtimeResult,
  };
};

const resolveSourceScopeKey = (payload: Record<string, unknown>) => {
  return AgentSignalScopeKey.fromProducerInput({
    applicationId: typeof payload.applicationId === 'string' ? payload.applicationId : undefined,
    platform: typeof payload.platform === 'string' ? payload.platform : undefined,
    platformThreadId:
      typeof payload.platformThreadId === 'string' ? payload.platformThreadId : undefined,
    topicId: typeof payload.topicId === 'string' ? payload.topicId : undefined,
  });
};

const executeAgentSignalSourceEventCore = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: ExecuteAgentSignalSourceEventOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  try {
    const sourceEvent = {
      payload: input.payload,
      scopeKey: input.scopeKey ?? resolveSourceScopeKey(input.payload),
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      timestamp: input.timestamp ?? Date.now(),
    };

    const emission = await emitSourceEvent(
      sourceEvent,
      options.store ? { store: options.store } : undefined,
    );
    if (emission.deduped) return emission;

    const runtime = await createAgentSignalRuntime({
      guardBackend: options.runtimeGuardBackend,
      policies: createDefaultAgentSignalPolicies({
        agentDocument: {
          service: new AgentDocumentsService(context.db, context.userId),
        },
        userMemory: {
          db: context.db,
          userId: context.userId,
        },
      }),
    });
    const runtimeResult = await runtime.emitNormalized(emission.source);
    const orchestration = buildRuntimeOrchestrationResult(emission.source, runtimeResult);

    await persistAgentSignalObservability(orchestration.observability);

    return {
      ...emission,
      orchestration,
    };
  } catch (error) {
    if (!options.ignoreError) throw error;

    console.error('[AgentSignal] Failed to emit source event:', error);
    return undefined;
  }
};

/**
 * Emits one source event into the AgentSignal pipeline and executes matching policies.
 *
 * Use when:
 * - Server-owned event producers need the normal AgentSignal boundary
 * - The caller should not control dedupe storage
 *
 * Expects:
 * - `context` points at the same database/user pair used by downstream policy execution
 *
 * Call stack:
 *
 * emitAgentSignalSourceEvent
 *   -> {@link emitSourceEvent}
 *   -> {@link createAgentSignalRuntime}
 *
 * Returns:
 * - A deduped result or a generated signal with orchestration details
 */
export const emitAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: AgentSignalEmitOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  if (!(await isAgentSignalEnabledForUser(context.db, context.userId))) {
    return undefined;
  }

  return executeAgentSignalSourceEventCore(input, context, options);
};

/**
 * Executes one source event immediately inside the current server process.
 *
 * Use when:
 * - A workflow worker or server-owned path already controls execution timing
 * - The caller needs optional Redis-backed runtime guard persistence
 *
 * Expects:
 * - `context` points at the same database/user pair used by downstream policy execution
 *
 * Returns:
 * - A deduped result or a generated signal with orchestration details
 */
export const executeAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: ExecuteAgentSignalSourceEventOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  if (!(await isAgentSignalEnabledForUser(context.db, context.userId))) {
    return undefined;
  }

  return executeAgentSignalSourceEventCore(input, context, options);
};

/**
 * Enqueues one source event for async AgentSignal execution through Upstash Workflow.
 *
 * Use when:
 * - The caller should return quickly and let async policy execution happen out-of-band
 * - The source event should still reuse the normal AgentSignal normalization boundary
 *
 * Expects:
 * - Payload contains enough routing context to derive a stable scope key
 *
 * Returns:
 * - The accepted workflow run identifier and normalized scope key
 */
export const enqueueAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: Pick<AgentSignalExecutionContext, 'agentId' | 'userId'>,
): Promise<QueuedAgentSignalEmissionResult> => {
  const db = await getServerDB();

  if (!(await isAgentSignalEnabledForUser(db, context.userId))) {
    return {
      accepted: false,
      scopeKey: input.scopeKey ?? resolveSourceScopeKey(input.payload),
      workflowRunId: '',
    };
  }

  const sourceEvent = {
    payload: input.payload,
    scopeKey: input.scopeKey ?? resolveSourceScopeKey(input.payload),
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    timestamp: input.timestamp ?? Date.now(),
  };

  log('Enqueueing source event payload=%O', {
    agentId: context.agentId,
    payload: sourceEvent.payload,
    scopeKey: sourceEvent.scopeKey,
    sourceId: sourceEvent.sourceId,
    sourceType: sourceEvent.sourceType,
    timestamp: sourceEvent.timestamp,
    userId: context.userId,
  });

  const trigger = await AgentSignalWorkflow.triggerRun({
    agentId: context.agentId,
    sourceEvent,
    userId: context.userId,
  });

  return {
    accepted: true,
    scopeKey: sourceEvent.scopeKey,
    workflowRunId: trigger.workflowRunId,
  };
};

/**
 * Emits one source event using an injected store for eval and test coverage.
 *
 * Use when:
 * - The caller needs the exact production orchestration path but with isolated in-memory dedupe state
 * - Eval or test code must avoid ambient Redis dependencies
 *
 * Expects:
 * - `store` implements the same contract as the Redis-backed source-event store
 *
 * Call stack:
 *
 * emitAgentSignalSourceEventWithStore
 *   -> {@link emitSourceEvent}
 *   -> {@link createAgentSignalRuntime}
 *
 * Returns:
 * - The same result shape as {@link emitAgentSignalSourceEvent}
 */
export const emitAgentSignalSourceEventWithStore = async <
  TSourceType extends AgentSignalSourceType,
>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  store: AgentSignalSourceEventStore,
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  return executeAgentSignalSourceEventCore(input, context, { store });
};
