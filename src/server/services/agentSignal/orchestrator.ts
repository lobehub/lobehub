import type {
  AgentSignalSource,
  BaseAction,
  BaseSignal,
  DedupedSourceEventResult,
  ExecutorResult,
  GeneratedSourceEventResult,
  SignalPlan,
} from '@lobechat/agent-signal';
import { type AgentSignalSourceType, createSourceEvent } from '@lobechat/agent-signal/source';

import {
  type AgentSignalEmitOptions,
  type AgentSignalExecutionContext,
  type AgentSignalSourceEventInput,
} from './emitter';
import { projectAgentSignalObservability } from './observability/projector';
import { persistAgentSignalObservability } from './observability/store';
import { createDefaultAgentSignalPolicies } from './policies';
import { createProcedurePolicyOptions } from './procedure';
import type { RuntimeGuardBackend } from './runtime/AgentSignalRuntime';
import { createAgentSignalRuntime } from './runtime/AgentSignalRuntime';
import { persistAgentSignalReceipts, projectAgentSignalReceipts } from './services/receiptService';
import { emitSourceEvent } from './sources';
import { redisPolicyStateStore } from './store/adapters/redis/policyStateStore';
import type { AgentSignalReceiptStore, AgentSignalSourceEventStore } from './store/types';

export { createAgentSignalRuntime } from './runtime/AgentSignalRuntime';

interface ExecuteAgentSignalSourceEventOptions extends AgentSignalEmitOptions {
  receiptStore?: AgentSignalReceiptStore;
  runtimeGuardBackend?: RuntimeGuardBackend;
  store?: AgentSignalSourceEventStore;
}

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

const executeAgentSignalSourceEventCore = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: ExecuteAgentSignalSourceEventOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  try {
    const sourceEvent = createSourceEvent(input);

    const emission = await emitSourceEvent(
      sourceEvent,
      options.store ? { store: options.store } : undefined,
    );
    if (emission.deduped) return emission;

    const procedurePolicyOptions =
      options.policyOptions?.procedure ??
      createProcedurePolicyOptions({
        policyStateStore: redisPolicyStateStore,
        ttlSeconds: 7 * 24 * 60 * 60,
      });

    const runtime = await createAgentSignalRuntime({
      guardBackend: options.runtimeGuardBackend,
      policies: createDefaultAgentSignalPolicies({
        feedbackDomainJudge: {
          db: context.db,
          ...options.policyOptions?.feedbackDomainJudge,
          userId: context.userId,
        },
        feedbackSatisfactionJudge: {
          db: context.db,
          ...options.policyOptions?.feedbackSatisfactionJudge,
          userId: context.userId,
        },
        classifierDiagnostics: options.policyOptions?.classifierDiagnostics,
        procedure: procedurePolicyOptions,
        userMemory: {
          db: context.db,
          ...options.policyOptions?.userMemory,
          userId: context.userId,
        },
        skillManagement: {
          db: context.db,
          ...options.policyOptions?.skillManagement,
          selfIterationEnabled:
            options.policyOptions?.skillManagement?.selfIterationEnabled ?? false,
          userId: context.userId,
        },
        skillIntentClassifier: {
          db: context.db,
          ...options.policyOptions?.skillIntentClassifier,
          userId: context.userId,
        },
      }),
    });
    const runtimeResult = await runtime.emitNormalized(emission.source);
    const orchestration = buildRuntimeOrchestrationResult(emission.source, runtimeResult);

    await persistAgentSignalObservability(orchestration.observability);
    const receipts = projectAgentSignalReceipts({
      actions: orchestration.actions,
      results: orchestration.results,
      source: emission.source,
      userId: context.userId,
    });
    await persistAgentSignalReceipts(receipts, { store: options.receiptStore });

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
  return executeAgentSignalSourceEventCore(input, context, options);
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
 * Returns:
 * - The same result shape as {@link executeAgentSignalSourceEvent}
 */
export const emitAgentSignalSourceEventWithStore = async <
  TSourceType extends AgentSignalSourceType,
>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  store: AgentSignalSourceEventStore,
  options: Pick<ExecuteAgentSignalSourceEventOptions, 'policyOptions'> = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  return executeAgentSignalSourceEventCore(input, context, {
    policyOptions: options.policyOptions,
    store,
  });
};
