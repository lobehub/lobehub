import type { SourceAgentSelfReflectionRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineSourceHandler } from '../../runtime/middleware';
import type {
  MaintenancePlan,
  MaintenancePlanDraft,
  MaintenancePlanRequest,
  MaintenanceReviewRunResult,
} from '../../services/maintenance/types';
import {
  buildSelfReflectionSourceId,
  MaintenanceReviewScope,
  ReviewRunStatus,
} from '../../services/maintenance/types';
import type { AgentSignalReceipt } from '../../services/receiptService';
import { createMaintenanceReviewReceipts } from '../../services/receiptService';

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
 * Receipt input emitted after one self-reflection maintenance execution.
 */
export interface SelfReflectionReceiptInput {
  /** Executor result for the completed self-reflection run. */
  execution: MaintenanceReviewRunResult;
  /** Normalized maintenance plan sent to the executor. */
  plan: MaintenancePlan;
  /** Stable reason that requested reflection. */
  reason: string;
  /** Runtime scope id reviewed by the run. */
  scopeId: string;
  /** Runtime scope family reviewed by the run. */
  scopeType: SelfReflectionSourceScopeType;
  /** Source id that triggered the run. */
  sourceId: string;
}

/**
 * Result returned by the self-reflection source handler.
 */
export interface SelfReflectionSourceHandlerResult extends Record<string, unknown> {
  /** Stable agent id being reviewed when payload validation succeeds. */
  agentId?: string;
  /** Executor result for completed runs. */
  execution?: MaintenanceReviewRunResult;
  /** Stable guard key used for idempotency when payload validation succeeds. */
  guardKey?: string;
  /** Number of planned maintenance actions before execution. */
  plannedActionCount?: number;
  /** Planner summary for receipt construction. */
  planSummary?: string;
  /** Machine-readable skip reason for non-completed runs. */
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
  /** Collects only source-scoped evidence without mutating maintenance resources. */
  collectContext: (
    input: CollectSelfReflectionContextInput,
  ) => Promise<SelfReflectionReviewContext>;
  /** Applies only the planner-approved maintenance plan mutations. */
  executePlan: (plan: MaintenancePlan) => Promise<MaintenanceReviewRunResult>;
  /** Converts reviewer output into a deterministic maintenance plan. */
  planReviewOutput: (request: MaintenancePlanRequest) => MaintenancePlan | Promise<MaintenancePlan>;
  /** Runs the bounded maintenance reviewer against collected scoped context. */
  runMaintenanceReviewAgent: (
    context: SelfReflectionReviewContext,
  ) => Promise<MaintenancePlanDraft>;
  /** Writes durable receipt metadata for the self-reflection run. */
  writeReceipt: (input: SelfReflectionReceiptInput) => Promise<void>;
  /** Writes durable receipt records for the review summary and action outcomes. */
  writeReceipts?: (receipts: AgentSignalReceipt[]) => Promise<void>;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

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

const writeSelfReflectionReceipt = async (
  deps: CreateSelfReflectionSourceHandlerDependencies,
  input: SelfReflectionReceiptInput,
) => {
  try {
    await deps.writeReceipt(input);
  } catch (error) {
    console.error('[AgentSignal] Failed to write self-reflection receipt:', error);
  }
};

const writeSelfReflectionReceipts = async (
  deps: CreateSelfReflectionSourceHandlerDependencies,
  receipts: AgentSignalReceipt[],
) => {
  if (!deps.writeReceipts || receipts.length === 0) return;

  try {
    await deps.writeReceipts(receipts);
  } catch (error) {
    console.error('[AgentSignal] Failed to write self-reflection receipts:', error);
  }
};

const applyReceiptIdsToExecution = (
  execution: MaintenanceReviewRunResult,
  receipts: AgentSignalReceipt[],
): MaintenanceReviewRunResult => {
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

/**
 * Creates the DI-friendly handler for self-reflection request sources.
 *
 * Triggering workflow:
 *
 * {@link createSelfReflectionSourcePolicyHandler}
 *   -> `agent.self_reflection.requested`
 *     -> {@link createSelfReflectionSourceHandler}
 *
 * Upstream:
 * - `agent.self_reflection.requested`
 *
 * Downstream:
 * - injected `executePlan`
 * - injected `writeReceipt`
 *
 * Use when:
 * - Tests need to run scoped self-reflection orchestration without DB or LLM dependencies
 * - Runtime policy composition needs a side-effect boundary before executing maintenance plans
 *
 * Expects:
 * - `source` is an `agent.self_reflection.requested` source with service-produced payload
 * - Dependencies enforce gates, idempotency, reviewer limits, executor persistence, and receipts
 *
 * Returns:
 * - A run result with status and enough plan metadata for self-reflection receipts
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
    const draft = await deps.runMaintenanceReviewAgent(context);
    const plan = await deps.planReviewOutput({
      draft,
      reviewScope: MaintenanceReviewScope.SelfReflection,
      sourceId: source.sourceId,
      userId: payload.userId,
    });
    const execution = await deps.executePlan(plan);
    const receipts = createMaintenanceReviewReceipts({
      agentId: payload.agentId,
      createdAt: source.timestamp,
      plan,
      result: {
        ...execution,
        sourceId: source.sourceId,
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

    await writeSelfReflectionReceipts(deps, receipts);

    await writeSelfReflectionReceipt(deps, {
      execution: executionWithReceipts,
      plan,
      reason: payload.reason,
      scopeId: payload.scopeId,
      scopeType: payload.scopeType,
      sourceId: source.sourceId,
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
 * Creates the runtime source handler definition for self-reflection policy composition.
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `agent.self_reflection.requested`
 *     -> {@link createSelfReflectionSourcePolicyHandler}
 *
 * Upstream:
 * - `agent.self_reflection.requested`
 *
 * Downstream:
 * - {@link createSelfReflectionSourceHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with self-reflection dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Expects:
 * - All server-only dependencies are injected by the caller
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the review run metadata
 */
export const createSelfReflectionSourcePolicyHandler = (
  deps: CreateSelfReflectionSourceHandlerDependencies,
) => {
  const handler = createSelfReflectionSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested}:maintenance-review`,
    async (source: SourceAgentSelfReflectionRequested) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
