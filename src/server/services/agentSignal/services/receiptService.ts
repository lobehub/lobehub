import type { AgentSignalSource, BaseAction, ExecutorResult } from '@lobechat/agent-signal';

import { AGENT_SIGNAL_DEFAULTS } from '../constants';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../policies/types';
import { redisReceiptStore } from '../store/adapters/redis/receiptStore';
import type {
  EvidenceRef,
  MaintenanceActionPlan,
  MaintenanceActionResult,
  MaintenanceActionType,
  MaintenancePlan,
  MaintenanceReviewRunResult,
} from './maintenance/types';
import {
  MaintenanceActionStatus,
  MaintenanceReviewScope,
  ReviewRunStatus,
} from './maintenance/types';

/** Metadata envelope used by maintenance receipts. */
export interface AgentSignalReceiptMetadata {
  /** Number of action results summarized by a review receipt. */
  actionCount?: number;
  /** Maintenance action status for action receipts. */
  actionStatus?: MaintenanceActionStatus;
  /** Maintenance action type for action receipts. */
  actionType?: MaintenanceActionType;
  /** Evidence refs used by the reviewer/planner. */
  evidenceRefs?: EvidenceRef[];
  /** User-local date for nightly receipts. */
  localDate?: string;
  /** Maintenance review scope that produced the receipt. */
  reviewScope?: MaintenanceReviewScope;
  /** Scoped self-reflection id for non-nightly review receipts. */
  scopeId?: string;
  /** Scoped self-reflection namespace for non-nightly review receipts. */
  scopeType?: string;
  /** Source type that produced the receipt. */
  sourceType?: string;
  /** IANA timezone used for nightly receipt projection. */
  timezone?: string;
}

/**
 * User-visible Agent Signal receipt persisted for recent topic activity.
 */
export interface AgentSignalReceipt {
  /** Agent that owns the topic. */
  agentId: string;
  /** Assistant message this receipt should render under when known. */
  anchorMessageId?: string;
  /** Millisecond timestamp used for newest-first receipt indexes. */
  createdAt: number;
  /** Fallback detail copy for clients without locale keys. */
  detail: string;
  /** Stable receipt id used as Redis member and payload key suffix. */
  id: string;
  /** User-facing durable outcome domain. */
  kind: 'maintenance' | 'memory' | 'review' | 'skill';
  /** Structured metadata for audit, brief linking, and eval assertions. */
  metadata?: AgentSignalReceiptMetadata;
  /** Agent runtime operation that produced the receipt, when known. */
  operationId?: string;
  /** Source event id that triggered the receipt. */
  sourceId: string;
  /** Source event type that triggered the receipt. */
  sourceType: string;
  /** User-facing terminal status. */
  status: 'applied' | 'completed' | 'failed' | 'proposed' | 'skipped' | 'updated';
  /** Snapshot of the resource affected when the receipt was produced. */
  target?: {
    /** Agent-document binding id for the concrete resource that should be opened. */
    agentDocumentId?: string;
    /** Backing document id for the concrete resource that should be opened in document UIs. */
    documentId?: string;
    /** Backing resource id for future navigation when still available. Skill ids use `documents.id`. */
    id?: string;
    /** Short summary captured at write time. */
    summary?: string;
    /** Human-readable resource title captured at write time. */
    title: string;
    /** User-facing resource domain. */
    type: 'memory' | 'skill';
  };
  /** Fallback title copy for clients without locale keys. */
  title: string;
  /** Topic where the receipt should be listed. */
  topicId: string;
  /** Owner used to enforce topic index isolation. */
  userId: string;
}

/** Query input for one scoped receipt page. */
export interface AgentSignalReceiptListInput {
  /** Agent whose topic receipts should be listed. */
  agentId: string;
  /** Zero-based sorted-set offset for the next page. */
  cursor?: number;
  /** Maximum receipt count to return. */
  limit: number;
  /** Exclusive lower createdAt boundary for polling only newer receipts. */
  sinceCreatedAt?: number;
  /** Topic whose receipts should be listed. */
  topicId: string;
  /** Current authenticated user. */
  userId: string;
}

/** Newest-first receipt page. */
export interface AgentSignalReceiptListResult {
  /** Next zero-based sorted-set offset, when another page exists. */
  cursor?: number;
  /** Receipts newest first. */
  receipts: AgentSignalReceipt[];
}

/** Storage contract for user-visible Agent Signal receipt history. */
export interface AgentSignalReceiptStore {
  appendReceipt: (receipt: AgentSignalReceipt, ttlSeconds: number) => Promise<boolean>;
  listReceipts: (input: AgentSignalReceiptListInput) => Promise<AgentSignalReceiptListResult>;
}

interface ProjectAgentSignalReceiptsInput {
  actions: BaseAction[];
  results: ExecutorResult[];
  source: AgentSignalSource;
  userId: string;
}

interface PersistAgentSignalReceiptsOptions {
  store?: AgentSignalReceiptStore;
}

/** Input used to create one maintenance review summary receipt. */
export interface CreateReviewSummaryReceiptInput {
  /** Agent that owns the reviewed scope. */
  agentId: string;
  /** Millisecond timestamp for receipt ordering. */
  createdAt?: number;
  /** User-local date for nightly reviews. */
  localDate?: string;
  /** Normalized maintenance plan that was executed. */
  plan: MaintenancePlan;
  /** Aggregated executor result for the review. */
  result: MaintenanceReviewRunResult;
  /** Scoped review id for self-reflection and intent runs. */
  scopeId?: string;
  /** Scoped review namespace for self-reflection and intent runs. */
  scopeType?: string;
  /** Source id that triggered the review. */
  sourceId: string;
  /** Source type that triggered the review. */
  sourceType: string;
  /** IANA timezone for nightly reviews. */
  timezone?: string;
  /** Topic index id for topic-local receipts. Falls back to source id for day-level receipts. */
  topicId?: string;
  /** User that owns the reviewed agent. */
  userId: string;
}

/** Input used to create one maintenance action receipt. */
export interface CreateMaintenanceActionReceiptInput {
  /** Planner-normalized action. */
  action: MaintenanceActionPlan;
  /** Agent that owns the reviewed scope. */
  agentId: string;
  /** Millisecond timestamp for receipt ordering. */
  createdAt?: number;
  /** User-local date for nightly reviews. */
  localDate?: string;
  /** Executor result for the action. */
  result: MaintenanceActionResult;
  /** Review scope that produced this action. */
  reviewScope: MaintenanceReviewScope;
  /** Scoped review id for self-reflection and intent runs. */
  scopeId?: string;
  /** Scoped review namespace for self-reflection and intent runs. */
  scopeType?: string;
  /** Source id that triggered the review. */
  sourceId: string;
  /** Source type that triggered the review. */
  sourceType: string;
  /** IANA timezone for nightly reviews. */
  timezone?: string;
  /** Topic index id for topic-local receipts. Falls back to source id for day-level receipts. */
  topicId?: string;
  /** User that owns the reviewed agent. */
  userId: string;
}

/** Input used to create all receipts for one maintenance review run. */
export interface CreateMaintenanceReviewReceiptsInput extends Omit<
  CreateReviewSummaryReceiptInput,
  'plan'
> {
  /** Normalized maintenance plan that was executed. */
  plan: MaintenancePlan;
}

const getPayloadString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const getClampedString = (value: string, maxLength = 96) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

const getReceiptTarget = (
  action: BaseAction,
  result: ExecutorResult,
  kind: AgentSignalReceipt['kind'],
): AgentSignalReceipt['target'] | undefined => {
  const target = result.output?.target;

  if (target && typeof target === 'object') {
    const payload = target as Record<string, unknown>;
    const title = typeof payload.title === 'string' ? payload.title.trim() : undefined;
    const type =
      payload.type === 'memory' || payload.type === 'skill'
        ? payload.type
        : kind === 'skill'
          ? 'skill'
          : 'memory';

    if (title) {
      return {
        ...(typeof payload.agentDocumentId === 'string' && payload.agentDocumentId.length > 0
          ? { agentDocumentId: payload.agentDocumentId }
          : {}),
        ...(typeof payload.documentId === 'string' && payload.documentId.length > 0
          ? { documentId: payload.documentId }
          : {}),
        ...(typeof payload.id === 'string' && payload.id.length > 0 ? { id: payload.id } : {}),
        ...(typeof payload.summary === 'string' && payload.summary.length > 0
          ? { summary: payload.summary }
          : {}),
        title,
        type,
      };
    }
  }

  if (kind !== 'memory') return;

  const message = getPayloadString(action.payload, 'message')?.trim();
  if (!message) return;

  return {
    title: getClampedString(message),
    type: 'memory',
  };
};

const toReceiptKind = (
  action: BaseAction,
): Pick<AgentSignalReceipt, 'detail' | 'kind' | 'status' | 'title'> | undefined => {
  if (action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle) {
    return {
      detail: 'Saved this for future replies',
      kind: 'memory',
      status: 'applied',
      title: 'Memory saved',
    };
  }

  if (action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle) {
    return {
      detail: 'Improved how this assistant handles similar requests',
      kind: 'skill',
      status: 'updated',
      title: 'Skill updated',
    };
  }

  return;
};

const getMaintenanceTopicId = (input: { sourceId: string; topicId?: string }) =>
  input.topicId ?? input.sourceId;

const getActionReceiptKind = (action: MaintenanceActionPlan): AgentSignalReceipt['kind'] =>
  action.operation?.domain ?? 'maintenance';

const getActionReceiptStatus = (
  status: MaintenanceActionStatus,
): AgentSignalReceipt['status'] | undefined => {
  if (status === MaintenanceActionStatus.Applied) return 'applied';
  if (status === MaintenanceActionStatus.Proposed) return 'proposed';

  return;
};

const getActionReceiptTitle = (action: MaintenanceActionPlan, result: MaintenanceActionResult) => {
  if (result.summary) return getClampedString(result.summary);
  if (action.actionType === 'write_memory') return 'Memory maintenance action';
  if (action.actionType === 'create_skill') return 'Skill creation proposal';
  if (action.actionType === 'refine_skill') return 'Skill refinement proposal';
  if (action.actionType === 'consolidate_skill') return 'Skill consolidation proposal';

  return 'Maintenance action';
};

/**
 * Creates one source-level receipt summarizing a maintenance review run.
 *
 * Use when:
 * - Nightly or scoped self-reflection handlers finish a maintenance review
 * - Receipts need one audit anchor before action-level receipts are linked to briefs
 *
 * Expects:
 * - `plan.reviewScope` is the authoritative review scope
 * - Topic-scoped reviews pass `topicId`; day-level reviews can omit it
 *
 * Returns:
 * - One stable summary receipt indexed by topic id or source id
 */
export const createReviewSummaryReceipt = (
  input: CreateReviewSummaryReceiptInput,
): AgentSignalReceipt => ({
  agentId: input.agentId,
  createdAt: input.createdAt ?? Date.now(),
  detail: input.plan.summary,
  id: `${input.sourceId}:review-summary`,
  kind: 'review',
  metadata: {
    actionCount: input.result.actions.length,
    evidenceRefs: input.plan.actions.flatMap((action) => action.evidenceRefs),
    ...(input.localDate ? { localDate: input.localDate } : {}),
    reviewScope: input.plan.reviewScope,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    ...(input.scopeType ? { scopeType: input.scopeType } : {}),
    sourceType: input.sourceType,
    ...(input.timezone ? { timezone: input.timezone } : {}),
  },
  sourceId: input.sourceId,
  sourceType: input.sourceType,
  status: input.result.status === ReviewRunStatus.Failed ? 'failed' : 'completed',
  title:
    input.plan.reviewScope === MaintenanceReviewScope.Nightly
      ? 'Nightly self-review completed'
      : 'Self-review completed',
  topicId: getMaintenanceTopicId(input),
  userId: input.userId,
});

/**
 * Creates one action-level maintenance receipt for applied or proposed actions.
 *
 * Use when:
 * - A maintenance action mutated a resource or produced a user-visible proposal
 * - Brief metadata needs durable receipt ids linked to individual outcomes
 *
 * Expects:
 * - The action/result pair share the same idempotency key
 * - Skipped, deduped, and failed actions are represented by the summary receipt only
 *
 * Returns:
 * - A stable action receipt, or `undefined` when no user-visible action receipt is needed
 */
export const createMaintenanceActionReceipt = (
  input: CreateMaintenanceActionReceiptInput,
): AgentSignalReceipt | undefined => {
  if (input.action.actionType === 'noop') return;

  const status = getActionReceiptStatus(input.result.status);
  if (!status) return;

  const kind = getActionReceiptKind(input.action);
  const title = getActionReceiptTitle(input.action, input.result);

  return {
    agentId: input.agentId,
    createdAt: input.createdAt ?? Date.now(),
    detail: input.action.rationale,
    id: `${input.action.idempotencyKey}:action`,
    kind,
    metadata: {
      actionStatus: input.result.status,
      actionType: input.action.actionType,
      evidenceRefs: input.action.evidenceRefs,
      ...(input.localDate ? { localDate: input.localDate } : {}),
      reviewScope: input.reviewScope,
      ...(input.scopeId ? { scopeId: input.scopeId } : {}),
      ...(input.scopeType ? { scopeType: input.scopeType } : {}),
      sourceType: input.sourceType,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    },
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    status,
    target: {
      ...(input.result.resourceId ? { id: input.result.resourceId } : {}),
      ...(input.result.summary ? { summary: input.result.summary } : {}),
      title,
      type: kind === 'skill' ? 'skill' : 'memory',
    },
    title,
    topicId: getMaintenanceTopicId(input),
    userId: input.userId,
  };
};

/**
 * Projects one review summary receipt plus applied/proposed action receipts.
 *
 * Use when:
 * - Source handlers need receipts before Daily Brief creation
 * - Tests need a single deterministic projection boundary
 *
 * Expects:
 * - `plan.actions` and `result.actions` share action idempotency keys
 *
 * Returns:
 * - Receipts ordered as summary first, then action results in executor order
 */
export const createMaintenanceReviewReceipts = (
  input: CreateMaintenanceReviewReceiptsInput,
): AgentSignalReceipt[] => {
  const actionByKey = new Map(input.plan.actions.map((action) => [action.idempotencyKey, action]));
  const actionReceipts = input.result.actions.flatMap((result) => {
    const action = actionByKey.get(result.idempotencyKey);
    if (!action) return [];

    const receipt = createMaintenanceActionReceipt({
      action,
      agentId: input.agentId,
      createdAt: input.createdAt,
      ...(input.localDate ? { localDate: input.localDate } : {}),
      result,
      reviewScope: input.plan.reviewScope,
      ...(input.scopeId ? { scopeId: input.scopeId } : {}),
      ...(input.scopeType ? { scopeType: input.scopeType } : {}),
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      ...(input.topicId ? { topicId: input.topicId } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      userId: input.userId,
    });

    return receipt ? [receipt] : [];
  });

  return [createReviewSummaryReceipt(input), ...actionReceipts];
};

/**
 * Projects terminal Agent Signal runtime results into user-visible receipts.
 *
 * Use when:
 * - Runtime orchestration has completed and action executor results are available
 * - Only durable, applied memory/skill outcomes should be shown to users
 *
 * Expects:
 * - `results` reference `actions` by `actionId`
 * - `source.payload.agentId` and `source.payload.topicId` identify the chat context
 *
 * Returns:
 * - Zero or more receipt payloads safe to persist in the recent receipt store
 */
export const projectAgentSignalReceipts = ({
  actions,
  results,
  source,
  userId,
}: ProjectAgentSignalReceiptsInput): AgentSignalReceipt[] => {
  const payload = source.payload as Record<string, unknown>;
  const agentId = getPayloadString(payload, 'agentId');
  const topicId = getPayloadString(payload, 'topicId');

  if (!agentId || !topicId) return [];

  const actionById = new Map(actions.map((action) => [action.actionId, action]));

  return results.flatMap((result) => {
    if (result.status !== 'applied') return [];

    const action = actionById.get(result.actionId);
    if (!action) return [];

    const visibleOutcome = toReceiptKind(action);
    if (!visibleOutcome) return [];

    const target = getReceiptTarget(action, result, visibleOutcome.kind);

    return [
      {
        ...visibleOutcome,
        agentId,
        anchorMessageId: getPayloadString(payload, 'assistantMessageId'),
        createdAt: source.timestamp,
        id: `${source.sourceId}:${result.actionId}:${visibleOutcome.kind}`,
        operationId: getPayloadString(payload, 'operationId'),
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        topicId,
        ...(target ? { target } : {}),
        userId,
      },
    ];
  });
};

/**
 * Persists user-visible Agent Signal receipts into recent Redis history.
 *
 * Use when:
 * - Agent Signal orchestration has projected terminal receipt outcomes
 * - The caller wants deduped, TTL-bound product feedback
 *
 * Expects:
 * - Receipts already passed product filtering
 *
 * Returns:
 * - Nothing; individual duplicate receipts are ignored by the store
 */
export const persistAgentSignalReceipts = async (
  receipts: AgentSignalReceipt[],
  options: PersistAgentSignalReceiptsOptions = {},
): Promise<void> => {
  const store = options.store ?? redisReceiptStore;

  const results = await Promise.allSettled(
    receipts.map((receipt) =>
      store.appendReceipt(receipt, AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds),
    ),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue;

    const receipt = receipts[index];
    console.error('[AgentSignal] Failed to persist receipt:', {
      error: result.reason,
      id: receipt?.id,
      kind: receipt?.kind,
      sourceId: receipt?.sourceId,
      topicId: receipt?.topicId,
    });
  }
};

/**
 * Lists recent Agent Signal receipts for one user-owned topic.
 */
export const listAgentSignalReceipts = async (
  input: AgentSignalReceiptListInput,
  options: { store?: AgentSignalReceiptStore } = {},
) => {
  return (options.store ?? redisReceiptStore).listReceipts(input);
};
