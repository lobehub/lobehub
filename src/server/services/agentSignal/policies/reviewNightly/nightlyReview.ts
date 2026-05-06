import type { SourceAgentNightlyReviewRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineSourceHandler } from '../../runtime/middleware';
import type { MaintenanceBriefProjection } from '../../services/maintenance/brief';
import { createBriefMaintenanceService } from '../../services/maintenance/brief';
import type {
  CollectNightlyReviewContextInput,
  NightlyReviewContext,
} from '../../services/maintenance/nightlyCollector';
import type {
  EvidenceRef,
  MaintenancePlan,
  MaintenancePlanDraft,
  MaintenancePlanRequest,
  MaintenanceReviewRunResult,
} from '../../services/maintenance/types';
import {
  buildNightlyReviewSourceId,
  MaintenanceReviewScope,
  ReviewRunStatus,
} from '../../services/maintenance/types';
import type { AgentSignalReceipt } from '../../services/receiptService';
import { createMaintenanceReviewReceipts } from '../../services/receiptService';

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
  /** Whether Daily Brief creation failed after maintenance execution. */
  briefWriteFailed?: boolean;
  /** Executor result for completed runs. */
  execution?: MaintenanceReviewRunResult;
  /** Stable guard key used for idempotency when payload validation succeeds. */
  guardKey?: string;
  /** User-local date in YYYY-MM-DD form when payload validation succeeds. */
  localDate?: string;
  /** Number of planned maintenance actions before execution. */
  plannedActionCount?: number;
  /** Planner summary for future brief construction. */
  planSummary?: string;
  /** Machine-readable skip reason for non-completed runs. */
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
  /** Collects bounded digest context without mutating maintenance resources. */
  collectContext: (input: CollectNightlyReviewContextInput) => Promise<NightlyReviewContext>;
  /** Applies only the planner-approved maintenance plan mutations. */
  executePlan: (plan: MaintenancePlan) => Promise<MaintenanceReviewRunResult>;
  /** Converts reviewer output into a deterministic maintenance plan. */
  planReviewOutput: (request: MaintenancePlanRequest) => MaintenancePlan | Promise<MaintenancePlan>;
  /** Runs the bounded maintenance reviewer against collected digest context. */
  runMaintenanceReviewAgent: (context: NightlyReviewContext) => Promise<MaintenancePlanDraft>;
  /** Writes a Daily Brief payload for user-visible nightly outcomes. */
  writeDailyBrief?: (brief: MaintenanceBriefProjection) => Promise<{ id?: string } | void>;
  /** Writes durable receipts for the review summary and action outcomes. */
  writeReceipts?: (receipts: AgentSignalReceipt[]) => Promise<void>;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

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

const collectPlanEvidenceRefs = (plan: MaintenancePlan): EvidenceRef[] => {
  const evidenceRefs = new Map<string, EvidenceRef>();

  for (const action of plan.actions) {
    for (const evidenceRef of action.evidenceRefs) {
      evidenceRefs.set(`${evidenceRef.type}:${evidenceRef.id}`, evidenceRef);
    }
  }

  return [...evidenceRefs.values()];
};

const writeNightlyReceipts = async (
  deps: CreateNightlyReviewSourceHandlerDependencies,
  receipts: AgentSignalReceipt[],
) => {
  if (!deps.writeReceipts || receipts.length === 0) return;

  try {
    await deps.writeReceipts(receipts);
  } catch (error) {
    console.error('[AgentSignal] Failed to write nightly review receipts:', error);
  }
};

const writeNightlyBrief = async (
  deps: CreateNightlyReviewSourceHandlerDependencies,
  brief: MaintenanceBriefProjection | undefined,
) => {
  if (!deps.writeDailyBrief || !brief) return {};

  try {
    const result = await deps.writeDailyBrief(brief);

    return result && result.id ? { briefId: result.id } : {};
  } catch (error) {
    console.error('[AgentSignal] Failed to write nightly review brief:', error);

    return { briefWriteFailed: true };
  }
};

/**
 * Creates the DI-friendly handler for nightly review request sources.
 *
 * Triggering workflow:
 *
 * {@link createNightlyReviewSourcePolicyHandler}
 *   -> `agent.nightly_review.requested`
 *     -> {@link createNightlyReviewSourceHandler}
 *
 * Upstream:
 * - `agent.nightly_review.requested`
 *
 * Downstream:
 * - injected `executePlan`
 *
 * Use when:
 * - Tests need to run the nightly review orchestration without DB or LLM dependencies
 * - Runtime policy composition needs a side-effect boundary before executing maintenance plans
 *
 * Expects:
 * - `source` is an `agent.nightly_review.requested` source with scheduler-produced payload
 * - Dependencies enforce gates, idempotency, reviewer limits, and executor persistence
 *
 * Returns:
 * - A run result with status and enough plan metadata for future brief builders
 */
export const createNightlyReviewSourceHandler = (
  deps: CreateNightlyReviewSourceHandlerDependencies,
) => ({
  handle: async (
    source: SourceAgentNightlyReviewRequested,
  ): Promise<NightlyReviewSourceHandlerResult> => {
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

    const context = await deps.collectContext({
      agentId: payload.agentId,
      reviewWindowEnd: payload.reviewWindowEnd,
      reviewWindowStart: payload.reviewWindowStart,
      userId: payload.userId,
    });
    const draft = await deps.runMaintenanceReviewAgent(context);
    const plan = await deps.planReviewOutput({
      draft,
      localDate: payload.localDate,
      reviewScope: MaintenanceReviewScope.Nightly,
      sourceId: source.sourceId,
      userId: payload.userId,
    });
    const execution = await deps.executePlan(plan);
    const receipts = createMaintenanceReviewReceipts({
      agentId: payload.agentId,
      createdAt: source.timestamp,
      localDate: payload.localDate,
      plan,
      result: {
        ...execution,
        sourceId: source.sourceId,
      },
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      timezone: payload.timezone,
      userId: payload.userId,
    });
    const executionWithReceipts = applyReceiptIdsToExecution(
      {
        ...execution,
        sourceId: source.sourceId,
      },
      receipts,
    );

    await writeNightlyReceipts(deps, receipts);

    const brief = createBriefMaintenanceService().projectNightlyReviewBrief({
      agentId: payload.agentId,
      evidenceRefs: collectPlanEvidenceRefs(plan),
      localDate: payload.localDate,
      result: executionWithReceipts,
      reviewWindowEnd: payload.reviewWindowEnd,
      reviewWindowStart: payload.reviewWindowStart,
      timezone: payload.timezone,
      userId: payload.userId,
    });
    const briefResult = await writeNightlyBrief(deps, brief);

    return {
      ...baseResult,
      ...briefResult,
      execution: {
        ...executionWithReceipts,
        ...('briefId' in briefResult ? { briefId: briefResult.briefId } : {}),
      },
      plannedActionCount: plan.actions.length,
      planSummary: plan.summary,
      status: execution.status,
    };
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
 * Upstream:
 * - `agent.nightly_review.requested`
 *
 * Downstream:
 * - {@link createNightlyReviewSourceHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with nightly review dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Expects:
 * - All server-only dependencies are injected by the caller
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the review run metadata
 */
export const createNightlyReviewSourcePolicyHandler = (
  deps: CreateNightlyReviewSourceHandlerDependencies,
) => {
  const handler = createNightlyReviewSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested}:maintenance-review`,
    async (source: SourceAgentNightlyReviewRequested) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
