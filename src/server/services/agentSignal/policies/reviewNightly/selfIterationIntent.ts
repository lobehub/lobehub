import type { SourceAgentSelfIterationIntentDeclared } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineSourceHandler } from '../../runtime/middleware';
import type {
  EvidenceRef,
  MaintenanceActionDraft,
  MaintenancePlan,
  MaintenancePlanDraft,
  MaintenancePlanRequest,
  MaintenanceReviewRunResult,
} from '../../services/maintenance/types';
import {
  buildSelfIterationIntentSourceId,
  MaintenanceReviewScope,
  ReviewRunStatus,
} from '../../services/maintenance/types';
import type { AgentSignalReceipt } from '../../services/receiptService';
import { createMaintenanceReviewReceipts } from '../../services/receiptService';

/** Source scope supported by self-iteration intent declarations. */
export type SelfIterationIntentSourceScopeType = 'operation' | 'topic';

/** Actions that an agent may declare as maintenance intent. */
export type SelfIterationIntentDeclaredAction =
  | 'write'
  | 'create'
  | 'refine'
  | 'consolidate'
  | 'proposal';

/** Maintenance target category declared by the running agent. */
export type SelfIterationIntentDeclaredKind = 'memory' | 'skill' | 'gap';

/**
 * Validated self-iteration intent source payload consumed by the handler.
 */
export interface SelfIterationIntentSourcePayload {
  /** Declared maintenance action. */
  action: SelfIterationIntentDeclaredAction;
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Agent-declared confidence from 0 to 1. */
  confidence: number;
  /** Source-provided evidence references. */
  evidenceRefs: EvidenceRef[];
  /** Declared maintenance target category. */
  kind: SelfIterationIntentDeclaredKind;
  /** Existing memory id when the intent targets a memory. */
  memoryId?: string;
  /** Runtime operation id when the declaration is operation-scoped. */
  operationId?: string;
  /** Agent rationale for the declared intent. */
  reason: string;
  /** Scope id selected from operation or topic payload fields. */
  scopeId: string;
  /** Scope type selected from operation or topic payload fields. */
  scopeType: SelfIterationIntentSourceScopeType;
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
 * Idempotency and gate input shared by self-iteration intent handler dependencies.
 */
export interface SelfIterationIntentSourceGuardInput extends SelfIterationIntentSourcePayload {
  /** Stable guard key for one declaration source. */
  guardKey: string;
  /** Normalized source id that triggered the run. */
  sourceId: string;
}

/**
 * Context enrichment input for agent-declared self-iteration intent.
 */
export interface EnrichSelfIterationIntentEvidenceInput {
  /** Declared maintenance action. */
  action: SelfIterationIntentDeclaredAction;
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Declared maintenance target category. */
  kind: SelfIterationIntentDeclaredKind;
  /** Runtime operation id when the declaration is operation-scoped. */
  operationId?: string;
  /** Scope id selected from operation or topic payload fields. */
  scopeId: string;
  /** Scope type selected from operation or topic payload fields. */
  scopeType: SelfIterationIntentSourceScopeType;
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
export interface SelfIterationIntentEvidenceEnrichment {
  /** Additional evidence references to append before deterministic planning. */
  evidenceRefs: EvidenceRef[];
  /** Whether current context shows an explicit user instruction conflict. */
  hasUserInstructionConflict?: boolean;
}

/**
 * Receipt input emitted after one self-iteration intent maintenance execution.
 */
export interface SelfIterationIntentReceiptInput {
  /** Executor result for the completed declaration run. */
  execution: MaintenanceReviewRunResult;
  /** Normalized maintenance plan sent to the executor. */
  plan: MaintenancePlan;
  /** Runtime scope id reviewed by the run. */
  scopeId: string;
  /** Runtime scope family reviewed by the run. */
  scopeType: SelfIterationIntentSourceScopeType;
  /** Source id that triggered the run. */
  sourceId: string;
  /** Tool-call id that produced the declaration. */
  toolCallId: string;
}

/**
 * Result returned by the self-iteration intent source handler.
 */
export interface SelfIterationIntentSourceHandlerResult extends Record<string, unknown> {
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
  /** Runtime scope id reviewed by the run. */
  scopeId?: string;
  /** Runtime scope family reviewed by the run. */
  scopeType?: SelfIterationIntentSourceScopeType;
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
 * Dependencies required by the self-iteration intent source handler.
 */
export interface CreateSelfIterationIntentSourceHandlerDependencies {
  /** Acquires the per-declaration idempotency guard. */
  acquireReviewGuard: (input: SelfIterationIntentSourceGuardInput) => Promise<boolean>;
  /** Re-checks runtime gates before doing reviewer work. */
  canRunReview: (input: SelfIterationIntentSourceGuardInput) => Promise<boolean>;
  /** Adds topic or operation evidence without mutating maintenance resources. */
  enrichEvidence?: (
    input: EnrichSelfIterationIntentEvidenceInput,
  ) => Promise<SelfIterationIntentEvidenceEnrichment>;
  /** Applies only the planner-approved maintenance plan mutations. */
  executePlan: (plan: MaintenancePlan) => Promise<MaintenanceReviewRunResult>;
  /** Converts declaration drafts into deterministic maintenance plans. */
  planReviewOutput: (request: MaintenancePlanRequest) => MaintenancePlan | Promise<MaintenancePlan>;
  /** Writes durable receipt metadata for the declaration run. */
  writeReceipt: (input: SelfIterationIntentReceiptInput) => Promise<void>;
  /** Writes durable receipt records for the review summary and action outcomes. */
  writeReceipts?: (receipts: AgentSignalReceipt[]) => Promise<void>;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isValidConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isSelfIterationIntentAction = (value: unknown): value is SelfIterationIntentDeclaredAction =>
  value === 'write' ||
  value === 'create' ||
  value === 'refine' ||
  value === 'consolidate' ||
  value === 'proposal';

const isSelfIterationIntentKind = (value: unknown): value is SelfIterationIntentDeclaredKind =>
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

const readSelfIterationIntentPayload = (
  source: SourceAgentSelfIterationIntentDeclared,
): SelfIterationIntentSourcePayload | undefined => {
  if (source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared) return;

  const payload = source.payload;
  if (
    !isSelfIterationIntentAction(payload.action) ||
    !isNonEmptyString(payload.agentId) ||
    !isValidConfidence(payload.confidence) ||
    !isSelfIterationIntentKind(payload.kind) ||
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
  payload: SelfIterationIntentSourcePayload,
  source: SourceAgentSelfIterationIntentDeclared,
): SelfIterationIntentSourceGuardInput => {
  return {
    ...payload,
    guardKey: buildSelfIterationIntentSourceId({
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
  payload: SelfIterationIntentSourcePayload,
): EnrichSelfIterationIntentEvidenceInput => ({
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
  guardInput: SelfIterationIntentSourceGuardInput,
): Omit<SelfIterationIntentSourceHandlerResult, 'status'> => ({
  agentId: guardInput.agentId,
  guardKey: guardInput.guardKey,
  scopeId: guardInput.scopeId,
  scopeType: guardInput.scopeType,
  sourceId: guardInput.sourceId,
  toolCallId: guardInput.toolCallId,
  userId: guardInput.userId,
});

const createDraftTarget = (
  payload: SelfIterationIntentSourcePayload,
): MaintenanceActionDraft['target'] => ({
  ...(payload.memoryId ? { memoryId: payload.memoryId } : {}),
  ...(payload.skillId ? { skillDocumentId: payload.skillId } : {}),
  ...(payload.topicId ? { topicIds: [payload.topicId] } : {}),
});

const createProposalDraft = (
  payload: SelfIterationIntentSourcePayload,
  evidenceRefs: EvidenceRef[],
  rationale: string,
): MaintenanceActionDraft => ({
  actionType: 'proposal_only',
  confidence: payload.confidence,
  evidenceRefs,
  rationale,
  target: createDraftTarget(payload),
  value: {
    action: payload.action,
    kind: payload.kind,
    reason: payload.reason,
    summary: payload.summary,
  },
});

const createActionDraft = (
  payload: SelfIterationIntentSourcePayload,
  evidenceRefs: EvidenceRef[],
  hasUserInstructionConflict?: boolean,
): MaintenanceActionDraft => {
  const rationale = hasUserInstructionConflict
    ? `${payload.reason} Skipped because it conflicts with an explicit user instruction.`
    : payload.reason;
  const confidence = hasUserInstructionConflict ? 0 : payload.confidence;
  const safeEvidenceRefs = hasUserInstructionConflict ? [] : evidenceRefs;
  const base = {
    confidence,
    evidenceRefs: safeEvidenceRefs,
    policyHints: hasUserInstructionConflict
      ? {
          evidenceStrength: 'weak' as const,
          userExplicitness: 'explicit' as const,
        }
      : {
          evidenceStrength: 'strong' as const,
          mutationScope: 'small' as const,
          persistence: 'stable' as const,
          sensitivity: 'normal' as const,
          userExplicitness: 'explicit' as const,
        },
    rationale,
    target: createDraftTarget(payload),
  };

  if (payload.kind === 'memory' && payload.action === 'write') {
    return {
      ...base,
      actionType: 'write_memory',
      value: {
        content: payload.summary,
        reason: payload.reason,
        userId: payload.userId,
      },
    };
  }

  if (payload.kind === 'skill' && payload.action === 'create') {
    return {
      ...base,
      actionType: 'create_skill',
      value: {
        bodyMarkdown: payload.summary,
        description: payload.reason,
        name: payload.summary,
        reason: payload.reason,
        summary: payload.summary,
        title: payload.summary,
        userId: payload.userId,
      },
    };
  }

  if (payload.kind === 'skill' && payload.action === 'refine' && payload.skillId) {
    return {
      ...base,
      actionType: 'refine_skill',
      value: {
        patch: payload.summary,
        reason: payload.reason,
        skillDocumentId: payload.skillId,
        summary: payload.summary,
        userId: payload.userId,
      },
    };
  }

  if (payload.kind === 'skill' && payload.action === 'consolidate' && payload.skillId) {
    return {
      ...base,
      actionType: 'consolidate_skill',
      value: {
        canonicalSkillDocumentId: payload.skillId,
        reason: payload.reason,
        sourceSkillIds: payload.skillId ? [payload.skillId] : [],
        summary: payload.summary,
        userId: payload.userId,
      },
    };
  }

  return {
    ...createProposalDraft(payload, safeEvidenceRefs, rationale),
    confidence,
  };
};

const toMaintenancePlanDraft = (
  payload: SelfIterationIntentSourcePayload,
  enrichment: SelfIterationIntentEvidenceEnrichment,
): MaintenancePlanDraft => ({
  actions: [
    createActionDraft(
      payload,
      [...payload.evidenceRefs, ...enrichment.evidenceRefs],
      enrichment.hasUserInstructionConflict,
    ),
  ],
  findings: [],
  summary: payload.summary,
});

const writeSelfIterationIntentReceipt = async (
  deps: CreateSelfIterationIntentSourceHandlerDependencies,
  input: SelfIterationIntentReceiptInput,
) => {
  try {
    await deps.writeReceipt(input);
  } catch (error) {
    console.error('[AgentSignal] Failed to write self-iteration intent receipt:', error);
  }
};

const writeSelfIterationIntentReceipts = async (
  deps: CreateSelfIterationIntentSourceHandlerDependencies,
  receipts: AgentSignalReceipt[],
) => {
  if (!deps.writeReceipts || receipts.length === 0) return;

  try {
    await deps.writeReceipts(receipts);
  } catch (error) {
    console.error('[AgentSignal] Failed to write self-iteration intent receipts:', error);
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
 * Creates the DI-friendly handler for self-iteration intent declaration sources.
 *
 * Triggering workflow:
 *
 * {@link createSelfIterationIntentSourcePolicyHandler}
 *   -> `agent.self_iteration_intent.declared`
 *     -> {@link createSelfIterationIntentSourceHandler}
 *
 * Upstream:
 * - `agent.self_iteration_intent.declared`
 *
 * Downstream:
 * - injected `planReviewOutput`
 * - injected `executePlan`
 * - injected `writeReceipt`
 *
 * Use when:
 * - Tests need to run declared-intent orchestration without DB or LLM dependencies
 * - Runtime policy composition needs a side-effect boundary before executing maintenance plans
 *
 * Expects:
 * - `source` is an `agent.self_iteration_intent.declared` source with service-produced payload
 * - Dependencies enforce gates, idempotency, planner policy, executor persistence, and receipts
 *
 * Returns:
 * - A run result with status and enough plan metadata for self-iteration intent receipts
 */
export const createSelfIterationIntentSourceHandler = (
  deps: CreateSelfIterationIntentSourceHandlerDependencies,
) => ({
  handle: async (
    source: SourceAgentSelfIterationIntentDeclared,
  ): Promise<SelfIterationIntentSourceHandlerResult> => {
    const payload = readSelfIterationIntentPayload(source);

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
    const draft = toMaintenancePlanDraft(payload, enrichment);
    const plan = await deps.planReviewOutput({
      draft,
      reviewScope: MaintenanceReviewScope.SelfIterationIntent,
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

    await writeSelfIterationIntentReceipts(deps, receipts);

    await writeSelfIterationIntentReceipt(deps, {
      execution: executionWithReceipts,
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
 * Creates the runtime source handler definition for self-iteration intent policy composition.
 *
 * Triggering workflow:
 *
 * {@link defineSourceHandler}
 *   -> `agent.self_iteration_intent.declared`
 *     -> {@link createSelfIterationIntentSourcePolicyHandler}
 *
 * Upstream:
 * - `agent.self_iteration_intent.declared`
 *
 * Downstream:
 * - {@link createSelfIterationIntentSourceHandler}
 *
 * Use when:
 * - Default Agent Signal policies are composed with self-iteration intent dependencies
 * - The runtime source registry needs an installable source handler definition
 *
 * Expects:
 * - All server-only dependencies are injected by the caller
 *
 * Returns:
 * - A source handler that concludes the runtime chain with the review run metadata
 */
export const createSelfIterationIntentSourcePolicyHandler = (
  deps: CreateSelfIterationIntentSourceHandlerDependencies,
) => {
  const handler = createSelfIterationIntentSourceHandler(deps);

  return defineSourceHandler(
    AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
    `${AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared}:maintenance-review`,
    async (source: SourceAgentSelfIterationIntentDeclared) => {
      const result = await handler.handle(source);

      return {
        concluded: result,
        status: 'conclude',
      };
    },
  );
};
