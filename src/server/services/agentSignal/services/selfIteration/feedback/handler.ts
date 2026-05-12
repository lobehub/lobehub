import type { SourceAgentSelfFeedbackIntentDeclared } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { ModelRuntime } from '@lobechat/model-runtime';

import { defineSourceHandler } from '../../../runtime/middleware';
import type { AgentSignalReceipt } from '../../receiptService';
import { createSelfFeedbackReceipts } from '../../receiptService';
import type { ExecuteSelfIterationInput, ExecuteSelfIterationResult } from '../execute';
import { projectRun } from '../projection';
import type { ToolSet } from '../tools/shared';
import type { EvidenceRef, Idea, Plan, RunResult, SelfFeedbackIntent } from '../types';
import { buildSelfFeedbackIntentSourceId, ReviewRunStatus, Scope } from '../types';

/** Source scope supported by self-feedback intent declarations. */
export type SelfFeedbackIntentSourceScopeType = 'operation' | 'topic';

/** Actions that an agent may declare as self-feedback intent. */
export type SelfFeedbackIntentDeclaredAction =
  | 'write'
  | 'create'
  | 'refine'
  | 'consolidate'
  | 'proposal';

/** Self-feedback target category declared by the running agent. */
export type SelfFeedbackIntentDeclaredKind = 'memory' | 'skill' | 'gap';

/**
 * Validated self-feedback intent source payload consumed by the handler.
 */
export interface SelfFeedbackIntentSourcePayload {
  /** Declared self-review action. */
  action: SelfFeedbackIntentDeclaredAction;
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Agent-declared confidence from 0 to 1. */
  confidence: number;
  /** Source-provided evidence references. */
  evidenceRefs: EvidenceRef[];
  /** Declared shared target category. */
  kind: SelfFeedbackIntentDeclaredKind;
  /** Existing memory id when the intent targets a memory. */
  memoryId?: string;
  /** Runtime operation id when the declaration is operation-scoped. */
  operationId?: string;
  /** Agent rationale for the declared intent. */
  reason: string;
  /** Scope id selected from operation or topic payload fields. */
  scopeId: string;
  /** Scope type selected from operation or topic payload fields. */
  scopeType: SelfFeedbackIntentSourceScopeType;
  /** Existing skill id when the intent targets a managed skill. */
  skillId?: string;
  /** Short declaration summary. */
  summary: string;
  /** Stable tool-call id used for source id verification. */
  toolCallId: string;
  /** Current topic id when available. */
  topicId?: string;
  /** Stable user id owning the agent. */
  userId: string;
}

/**
 * Idempotency and gate input shared by self-feedback intent handler dependencies.
 */
export interface SelfFeedbackIntentSourceGuardInput extends SelfFeedbackIntentSourcePayload {
  /** Stable guard key for one declaration source. */
  guardKey: string;
  /** Normalized source id that triggered the run. */
  sourceId: string;
}

/**
 * Context enrichment input for agent-declared self-feedback intent.
 */
export interface EnrichSelfFeedbackIntentEvidenceInput {
  /** Declared self-review action. */
  action: SelfFeedbackIntentDeclaredAction;
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Declared shared target category. */
  kind: SelfFeedbackIntentDeclaredKind;
  /** Runtime operation id when the declaration is operation-scoped. */
  operationId?: string;
  /** Scope id selected from operation or topic payload fields. */
  scopeId: string;
  /** Scope type selected from operation or topic payload fields. */
  scopeType: SelfFeedbackIntentSourceScopeType;
  /** Stable tool-call id used for source id verification. */
  toolCallId: string;
  /** Current topic id when available. */
  topicId?: string;
  /** Stable user id owning the agent. */
  userId: string;
}

/**
 * Extra evidence collected from the current operation or topic.
 */
export interface SelfFeedbackIntentEvidenceEnrichment {
  /** Additional evidence references to append before deterministic planning. */
  evidenceRefs: EvidenceRef[];
  /** Whether current context shows an explicit user instruction conflict. */
  hasUserInstructionConflict?: boolean;
}

/**
 * Per-run runtime dependencies for the self-iteration executor.
 */
export interface SelfFeedbackIntentRuntimeConfig {
  /** Runs the self-iteration executor. */
  executeSelfIteration: (input: ExecuteSelfIterationInput) => Promise<ExecuteSelfIterationResult>;
  /**
   * Maximum self-iteration runtime steps.
   *
   * @default 10
   */
  maxSteps?: number;
  /** Model name used by the self-iteration runtime. */
  model: string;
  /** Model runtime used by the self-iteration runtime. */
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  /** Source-scoped safe tools exposed to the self-iteration runtime. */
  tools: ToolSet;
}

/**
 * Input used to create source-scoped runtime dependencies for declared intent handling.
 */
export interface SelfFeedbackIntentRuntimeFactoryInput {
  /** Evidence enrichment already collected for this declaration source. */
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  /** Validated declaration payload. */
  payload: SelfFeedbackIntentSourcePayload;
  /** Source event that triggered the handler. */
  source: SourceAgentSelfFeedbackIntentDeclared;
}

/**
 * Class-backed boundary that creates source-scoped runtime dependencies.
 */
export interface SelfFeedbackIntentRuntimeFactory {
  /** Builds the model/runtime/tools bundle for one declared intent source. */
  createRuntime: (
    input: SelfFeedbackIntentRuntimeFactoryInput,
  ) => Promise<SelfFeedbackIntentRuntimeConfig> | SelfFeedbackIntentRuntimeConfig;
}

/**
 * Receipt input emitted after one self-feedback execution.
 */
export interface SelfFeedbackIntentReceiptInput {
  /** Executor result for the completed declaration run. */
  execution: RunResult;
  /** Non-actionable ideas captured by the self-iteration runtime. */
  ideas?: Idea[];
  /** Immediate intents captured by the self-iteration runtime. */
  intents?: SelfFeedbackIntent[];
  /** Normalized self-iteration plan sent to the executor. */
  plan: Plan;
  /** Runtime scope id reviewed by the run. */
  scopeId: string;
  /** Runtime scope family reviewed by the run. */
  scopeType: SelfFeedbackIntentSourceScopeType;
  /** Source id that triggered the run. */
  sourceId: string;
  /** Tool-call id that produced the declaration. */
  toolCallId: string;
}

/**
 * Result returned by the self-feedback intent source handler.
 */
export interface SelfFeedbackIntentSourceHandlerResult extends Record<string, unknown> {
  /** Stable agent id being reviewed when payload validation succeeds. */
  agentId?: string;
  /** Executor result for completed runs. */
  execution?: RunResult;
  /** Stable guard key used for idempotency when payload validation succeeds. */
  guardKey?: string;
  /** Number of planned self-review actions before execution. */
  plannedActionCount?: number;
  /** Planner summary for receipt construction. */
  planSummary?: string;
  /** Machine-readable skip reason for non-completed runs. */
  reason?: 'gate_disabled' | 'invalid_payload';
  /** Runtime scope id reviewed by the run. */
  scopeId?: string;
  /** Runtime scope family reviewed by the run. */
  scopeType?: SelfFeedbackIntentSourceScopeType;
  /** Source id that triggered the run. */
  sourceId?: string;
  /** Coarse run status for observability and retry semantics. */
  status: ReviewRunStatus;
  /** Tool-call id that produced the declaration. */
  toolCallId?: string;
  /** Stable user id owning the agent when payload validation succeeds. */
  userId?: string;
}

/**
 * Dependencies required by the self-feedback intent source handler.
 */
export interface CreateSelfFeedbackIntentSourceHandlerDependencies {
  /** Acquires the per-declaration idempotency guard. */
  acquireReviewGuard: (input: SelfFeedbackIntentSourceGuardInput) => Promise<boolean>;
  /** Re-checks runtime gates before doing reviewer work. */
  canRunReview: (input: SelfFeedbackIntentSourceGuardInput) => Promise<boolean>;
  /** Adds topic or operation evidence without mutating shared resources. */
  enrichEvidence?: (
    input: EnrichSelfFeedbackIntentEvidenceInput,
  ) => Promise<SelfFeedbackIntentEvidenceEnrichment>;
  /** Runs the self-iteration runtime when no source-scoped factory is injected. */
  executeSelfIteration?: (input: ExecuteSelfIterationInput) => Promise<ExecuteSelfIterationResult>;
  /**
   * Maximum self-iteration runtime steps.
   *
   * @default 10
   */
  maxSteps?: number;
  /** Model name used by the self-iteration runtime. */
  model?: string;
  /** Model runtime used by the self-iteration runtime. */
  modelRuntime?: Pick<ModelRuntime, 'chat'>;
  /** Builds source-scoped shared-runtime dependencies for intent mode. */
  runtimeFactory?: SelfFeedbackIntentRuntimeFactory;
  /** Safe tools exposed to the self-iteration runtime. */
  tools?: ToolSet;
  /** Writes durable receipt metadata for the declaration run. */
  writeReceipt: (input: SelfFeedbackIntentReceiptInput) => Promise<void>;
  /** Writes durable receipt records for the review summary and action outcomes. */
  writeReceipts?: (receipts: AgentSignalReceipt[]) => Promise<void>;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isValidConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isSelfFeedbackIntentAction = (value: unknown): value is SelfFeedbackIntentDeclaredAction =>
  value === 'write' ||
  value === 'create' ||
  value === 'refine' ||
  value === 'consolidate' ||
  value === 'proposal';

const isSelfFeedbackIntentKind = (value: unknown): value is SelfFeedbackIntentDeclaredKind =>
  value === 'memory' || value === 'skill' || value === 'gap';

const isEvidenceRefType = (value: unknown): value is EvidenceRef['type'] =>
  value === 'topic' ||
  value === 'message' ||
  value === 'operation' ||
  value === 'source' ||
  value === 'receipt' ||
  value === 'tool_call' ||
  value === 'task' ||
  value === 'agent_document' ||
  value === 'memory';

const readEvidenceRefs = (value: unknown): EvidenceRef[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): EvidenceRef[] => {
    if (!item || typeof item !== 'object') return [];

    const id = 'id' in item ? item.id : undefined;
    const type = 'type' in item ? item.type : undefined;
    if (!isNonEmptyString(id) || !isEvidenceRefType(type)) return [];

    const summary = 'summary' in item ? item.summary : undefined;

    return [
      {
        id,
        ...(isNonEmptyString(summary) ? { summary } : {}),
        type,
      },
    ];
  });
};

const readSelfFeedbackIntentPayload = (
  source: SourceAgentSelfFeedbackIntentDeclared,
): SelfFeedbackIntentSourcePayload | undefined => {
  if (source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared) return;

  const payload = source.payload;
  if (
    !isSelfFeedbackIntentAction(payload.action) ||
    !isNonEmptyString(payload.agentId) ||
    !isValidConfidence(payload.confidence) ||
    !isSelfFeedbackIntentKind(payload.kind) ||
    !isNonEmptyString(payload.reason) ||
    !isNonEmptyString(payload.summary) ||
    !isNonEmptyString(payload.toolCallId) ||
    !isNonEmptyString(payload.userId)
  ) {
    return;
  }

  const scope = isNonEmptyString(payload.operationId)
    ? ({ scopeId: payload.operationId, scopeType: 'operation' } as const)
    : isNonEmptyString(payload.topicId)
      ? ({ scopeId: payload.topicId, scopeType: 'topic' } as const)
      : undefined;

  if (!scope) return;

  return {
    action: payload.action,
    agentId: payload.agentId,
    confidence: payload.confidence,
    evidenceRefs: readEvidenceRefs(payload.evidenceRefs),
    kind: payload.kind,
    ...(isNonEmptyString(payload.memoryId) ? { memoryId: payload.memoryId } : {}),
    ...(isNonEmptyString(payload.operationId) ? { operationId: payload.operationId } : {}),
    reason: payload.reason,
    ...(isNonEmptyString(payload.skillId) ? { skillId: payload.skillId } : {}),
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    summary: payload.summary,
    toolCallId: payload.toolCallId,
    ...(isNonEmptyString(payload.topicId) ? { topicId: payload.topicId } : {}),
    userId: payload.userId,
  };
};

const toGuardInput = (
  payload: SelfFeedbackIntentSourcePayload,
  source: SourceAgentSelfFeedbackIntentDeclared,
): SelfFeedbackIntentSourceGuardInput => {
  return {
    ...payload,
    guardKey: buildSelfFeedbackIntentSourceId({
      agentId: payload.agentId,
      scopeId: payload.scopeId,
      scopeType: payload.scopeType,
      toolCallId: payload.toolCallId,
      userId: payload.userId,
    }),
    sourceId: source.sourceId,
  };
};

const toEnrichEvidenceInput = (
  payload: SelfFeedbackIntentSourcePayload,
): EnrichSelfFeedbackIntentEvidenceInput => ({
  action: payload.action,
  agentId: payload.agentId,
  kind: payload.kind,
  ...(payload.operationId ? { operationId: payload.operationId } : {}),
  scopeId: payload.scopeId,
  scopeType: payload.scopeType,
  toolCallId: payload.toolCallId,
  ...(payload.topicId ? { topicId: payload.topicId } : {}),
  userId: payload.userId,
});

const toBaseResult = (
  guardInput: SelfFeedbackIntentSourceGuardInput,
): Omit<SelfFeedbackIntentSourceHandlerResult, 'status'> => ({
  agentId: guardInput.agentId,
  guardKey: guardInput.guardKey,
  scopeId: guardInput.scopeId,
  scopeType: guardInput.scopeType,
  sourceId: guardInput.sourceId,
  toolCallId: guardInput.toolCallId,
  userId: guardInput.userId,
});

const writeSelfFeedbackIntentReceipt = async (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
  input: SelfFeedbackIntentReceiptInput,
) => {
  try {
    await deps.writeReceipt(input);
  } catch (error) {
    console.error('[AgentSignal] Failed to write self-feedback intent receipt:', error);
  }
};

const writeSelfFeedbackIntentReceipts = async (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
  receipts: AgentSignalReceipt[],
) => {
  if (!deps.writeReceipts || receipts.length === 0) return;

  try {
    await deps.writeReceipts(receipts);
  } catch (error) {
    console.error('[AgentSignal] Failed to write self-feedback intent receipts:', error);
  }
};

const applyReceiptIdsToExecution = (
  execution: RunResult,
  receipts: AgentSignalReceipt[],
): RunResult => {
  const receiptByActionKey = new Map(
    receipts
      .filter((receipt) => receipt.id.endsWith(':action'))
      .map((receipt) => [receipt.id.slice(0, -':action'.length), receipt.id]),
  );

  return {
    ...execution,
    actions: execution.actions.map((action) => ({
      ...action,
      ...(receiptByActionKey.get(action.idempotencyKey)
        ? { receiptId: receiptByActionKey.get(action.idempotencyKey) }
        : {}),
    })),
    summaryReceiptId: `${execution.sourceId ?? receipts[0]?.sourceId}:review-summary`,
  };
};

const canExecuteSharedSelfIteration = (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
): deps is CreateSelfFeedbackIntentSourceHandlerDependencies & {
  executeSelfIteration: (input: ExecuteSelfIterationInput) => Promise<ExecuteSelfIterationResult>;
  model: string;
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  tools: ToolSet;
} => Boolean(deps.executeSelfIteration && deps.model && deps.modelRuntime && deps.tools);

const createIntentRuntimeContext = ({
  enrichment,
  payload,
  sourceId,
}: {
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  payload: SelfFeedbackIntentSourcePayload;
  sourceId: string;
}) => ({
  agentId: payload.agentId,
  evidenceRefs: [...payload.evidenceRefs, ...enrichment.evidenceRefs],
  intent: payload,
  sourceId,
  userId: payload.userId,
});

const runSharedSelfFeedbackIntent = async ({
  deps,
  enrichment,
  payload,
  runtime,
  source,
}: {
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies;
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  payload: SelfFeedbackIntentSourcePayload;
  runtime: SelfFeedbackIntentRuntimeConfig;
  source: SourceAgentSelfFeedbackIntentDeclared;
}) => {
  const timestamp = new Date(source.timestamp).toISOString();
  const runtimeResult = await runtime.executeSelfIteration({
    agentId: payload.agentId,
    context: createIntentRuntimeContext({ enrichment, payload, sourceId: source.sourceId }),
    maxSteps: runtime.maxSteps ?? deps.maxSteps ?? 10,
    mode: 'feedback',
    model: runtime.model,
    modelRuntime: runtime.modelRuntime,
    sourceId: source.sourceId,
    tools: runtime.tools,
    userId: payload.userId,
    window: {
      end: timestamp,
      start: timestamp,
    },
  });
  const projected = projectRun({
    content: runtimeResult.content,
    outcomes: runtimeResult.writeOutcomes.map((outcome) => ({
      ...outcome.result,
      toolName: outcome.toolName,
    })),
    reviewScope: Scope.SelfFeedback,
    sourceId: source.sourceId,
    toolCalls: runtimeResult.toolCalls,
    userId: payload.userId,
  });

  return {
    execution: projected.execution,
    ideas: runtimeResult.ideas,
    plan: projected.projectionPlan,
    runtimeIntents: runtimeResult.intents,
    window: { end: timestamp, start: timestamp },
  };
};

const resolveSharedSelfFeedbackIntentRuntime = async ({
  deps,
  enrichment,
  payload,
  source,
}: {
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies;
  enrichment: SelfFeedbackIntentEvidenceEnrichment;
  payload: SelfFeedbackIntentSourcePayload;
  source: SourceAgentSelfFeedbackIntentDeclared;
}): Promise<SelfFeedbackIntentRuntimeConfig | undefined> => {
  if (deps.runtimeFactory) {
    return deps.runtimeFactory.createRuntime({ enrichment, payload, source });
  }

  if (!canExecuteSharedSelfIteration(deps)) return;

  return {
    executeSelfIteration: deps.executeSelfIteration,
    maxSteps: deps.maxSteps,
    model: deps.model,
    modelRuntime: deps.modelRuntime,
    tools: deps.tools,
  };
};

/**
 * Creates the DI-friendly handler for self-feedback intent declaration sources.
 *
 * Triggering workflow:
 *
 * {@link createSelfFeedbackIntentSourcePolicyHandler}
 *   -> `agent.self_feedback_intent.declared`
 *     -> {@link createSelfFeedbackIntentSourceHandler}
 *
 * Upstream:
 * - `agent.self_feedback_intent.declared`
 *
 * Downstream:
 * - injected self-iteration executor
 * - injected `writeReceipt`
 *
 * Use when:
 * - Tests need to run declared-intent orchestration without DB or LLM dependencies
 * - Runtime policy composition needs a side-effect boundary before executing self-iteration plans
 *
 * Expects:
 * - `source` is an `agent.self_feedback_intent.declared` source with service-produced payload
 * - Dependencies enforce gates, idempotency, executor persistence, and receipts
 *
 * Returns:
 * - A run result with status and enough plan metadata for self-feedback intent receipts
 */
export const createSelfFeedbackIntentSourceHandler = (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
) => ({
  handle: async (
    source: SourceAgentSelfFeedbackIntentDeclared,
  ): Promise<SelfFeedbackIntentSourceHandlerResult> => {
    const payload = readSelfFeedbackIntentPayload(source);

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

    const enrichment = (await deps.enrichEvidence?.(toEnrichEvidenceInput(payload))) ?? {
      evidenceRefs: [],
    };
    const runtime = await resolveSharedSelfFeedbackIntentRuntime({
      deps,
      enrichment,
      payload,
      source,
    });

    if (!runtime) throw new Error('Self-iteration intent self-iteration runtime is required.');

    const runtimeRun = await runSharedSelfFeedbackIntent({
      deps,
      enrichment,
      payload,
      runtime,
      source,
    });
    const plan: Plan = runtimeRun.plan;
    const execution: RunResult = runtimeRun.execution;

    const receipts = createSelfFeedbackReceipts({
      agentId: payload.agentId,
      createdAt: source.timestamp,
      plan,
      result: {
        ...execution,
        sourceId: source.sourceId,
      },
      selfIteration: {
        ideas: runtimeRun.ideas,
        intents: runtimeRun.runtimeIntents,
        mode: 'feedback',
        scope: { id: payload.scopeId, type: payload.scopeType },
        sourceId: source.sourceId,
        toolCallId: payload.toolCallId,
        window: runtimeRun.window,
      },
      scopeId: payload.scopeId,
      scopeType: payload.scopeType,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      ...(payload.topicId ? { topicId: payload.topicId } : {}),
      userId: payload.userId,
    });
    const executionWithReceipts = applyReceiptIdsToExecution(
      {
        ...execution,
        sourceId: source.sourceId,
      },
      receipts,
    );

    await writeSelfFeedbackIntentReceipts(deps, receipts);

    await writeSelfFeedbackIntentReceipt(deps, {
      execution: executionWithReceipts,
      ideas: runtimeRun?.ideas,
      intents: runtimeRun?.runtimeIntents,
      plan,
      scopeId: payload.scopeId,
      scopeType: payload.scopeType,
      sourceId: source.sourceId,
      toolCallId: payload.toolCallId,
    });

    return {
      ...baseResult,
      execution: executionWithReceipts,
      plannedActionCount: plan.actions.length,
      planSummary: plan.summary,
      status: execution.status,
    };
  },
});

/**
 * Creates the runtime source handler definition for self-feedback intent policy composition.
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `agent.self_feedback_intent.declared`
 *     -> {@link createSelfFeedbackIntentSourcePolicyHandler}
 *
 * Upstream:
 * - `agent.self_feedback_intent.declared`
 *
 * Downstream:
 * - {@link createSelfFeedbackIntentSourceHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with self-feedback intent dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Expects:
 * - All server-only dependencies are injected by the caller
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the review run metadata
 */
export const createSelfFeedbackIntentSourcePolicyHandler = (
  deps: CreateSelfFeedbackIntentSourceHandlerDependencies,
) => {
  const handler = createSelfFeedbackIntentSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared}:shared-review`,
    async (source: SourceAgentSelfFeedbackIntentDeclared) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
