import type { BriefAction } from '@lobechat/types';
import { z } from 'zod';

import type {
  ActionPlan,
  ActionResult,
  ActionTarget,
  ActionType,
  EvidenceRef,
  Plan,
} from '../types';
import { ActionStatus, Risk } from '../types';

export const SELF_REVIEW_PROPOSAL_VERSION = 1;

export type SelfReviewProposalStatus =
  | 'pending'
  | 'accepted'
  | 'applying'
  | 'applied'
  | 'partially_failed'
  | 'failed'
  | 'dismissed'
  | 'expired'
  | 'stale'
  | 'superseded';

const SELF_ITERATION_ACTION_TYPES = [
  'write_memory',
  'create_skill',
  'refine_skill',
  'consolidate_skill',
  'noop',
  'proposal_only',
] as const satisfies ActionType[];

const SELF_REVIEW_PROPOSAL_STATUSES = [
  'pending',
  'accepted',
  'applying',
  'applied',
  'partially_failed',
  'failed',
  'dismissed',
  'expired',
  'stale',
  'superseded',
] as const satisfies SelfReviewProposalStatus[];

const SELF_ITERATION_RISKS = [Risk.High, Risk.Low, Risk.Medium] as const satisfies Risk[];

export type SelfReviewProposalConflictReason =
  | 'agent_gate_disabled'
  | 'content_changed'
  | 'document_changed'
  | 'snapshot_incomplete'
  | 'snapshot_missing'
  | 'target_conflict'
  | 'target_deleted'
  | 'target_unmanaged'
  | 'target_not_writable'
  | 'target_type_changed'
  | 'user_gate_disabled'
  | 'server_gate_disabled';

export interface BuildSelfReviewProposalKeyInput {
  /** Action category represented by the proposal. */
  actionType: ActionType;
  /** Agent whose self-review produced the proposal. */
  agentId: string;
  /** Stable target id inside the selected target type. */
  targetId: string;
  /** Target namespace used to avoid collisions across resource tables. */
  targetType: 'agent_document' | 'memory' | 'skill' | 'unknown';
}

export interface SelfReviewProposalBaseSnapshot {
  /** Whether the target was absent when the proposal was approved for creation. */
  absent?: boolean;
  /** Agent document id when the proposal targets managed skill/document state. */
  agentDocumentId?: string;
  /** Content hash observed when the proposal was created. */
  contentHash?: string;
  /** Canonical document id observed when the proposal was created. */
  documentId?: string;
  /** Last document update timestamp observed when the proposal was created. */
  documentUpdatedAt?: string;
  /** Whether the target was managed by Agent Signal. */
  managed?: boolean;
  /** Stable skill name observed or reserved when the proposal was created. */
  skillName?: string;
  /** Human-readable target title observed at proposal time. */
  targetTitle?: string;
  /** Target domain captured by the proposal snapshot. */
  targetType?: 'skill';
  /** Whether the target was writable at proposal time. */
  writable?: boolean;
}

export interface SelfReviewProposalAction {
  /** Planned action type frozen into the proposal. */
  actionType: ActionType;
  /** Optional target freshness snapshot used by approve-time preflight. */
  baseSnapshot?: SelfReviewProposalBaseSnapshot;
  /** Bounded evidence references retained for audit and prompt context. */
  evidenceRefs: EvidenceRef[];
  /** Stable operation idempotency key from the original self-iteration plan. */
  idempotencyKey: string;
  /** Frozen domain operation to apply after user approval when still fresh. */
  operation?: ActionPlan['operation'];
  /** Reviewer rationale shown to users and future shared runs. */
  rationale: string;
  /** Risk assigned by the self-iteration planner. */
  risk: Risk;
  /** Bounded target identity from the original plan. */
  target?: ActionTarget;
}

/** Non-actionable self-review thought retained for future review without approve-time mutation. */
export interface SelfReviewIdea {
  /** Bounded evidence references retained for audit and future review context. */
  evidenceRefs: EvidenceRef[];
  /** Stable idempotency key from the proposal-only action. */
  idempotencyKey: string;
  /** Reviewer rationale explaining why this is an idea instead of an executable action. */
  rationale: string;
  /** Risk assigned by the self-reviewer. */
  risk: Risk;
  /** Optional target identity the idea is about. */
  target?: ActionTarget;
  /** Optional short title for UI or digest presentation. */
  title?: string;
}

/**
 * Proposal projection action for mergeable skill mutations.
 *
 * @param TActionType - Mergeable action type that must carry a complete base snapshot.
 */
export type MergeableSelfReviewProposalActionPlan<
  TActionType extends 'create_skill' | 'refine_skill' = 'create_skill' | 'refine_skill',
> = ActionPlan & {
  /** Mergeable action type that will be applied from a frozen proposal. */
  actionType: TActionType;
  /** Complete merge base captured before proposal projection. */
  baseSnapshot: SelfReviewProposalBaseSnapshot;
};

/**
 * Proposal projection action for non-mergeable self-iteration mutations.
 */
export type NonMergeableSelfReviewProposalActionPlan = ActionPlan & {
  /** Non-mergeable action type that can use legacy title-only fallback snapshots. */
  actionType: Exclude<ActionType, 'create_skill' | 'refine_skill'>;
  /** Optional proposal snapshot supplied by callers before projection. */
  baseSnapshot?: SelfReviewProposalBaseSnapshot;
};

/**
 * Snapshot-aware action accepted by proposal metadata projection.
 */
export type SelfReviewProposalActionPlan =
  | MergeableSelfReviewProposalActionPlan
  | NonMergeableSelfReviewProposalActionPlan;

/**
 * Snapshot-aware self-iteration plan accepted by proposal metadata projection.
 */
export type SelfReviewProposalPlan = Omit<Plan, 'actions'> & {
  /** Planned actions with required base snapshots for mergeable proposal mutations. */
  actions: SelfReviewProposalActionPlan[];
};

export interface SelfReviewProposalActionApplyResult {
  /** Frozen action idempotency key this apply result belongs to. */
  idempotencyKey: string;
  /** Resource id touched by the action when one exists. */
  resourceId?: string;
  /** Apply status emitted by the approve-time merge path. */
  status: 'applied' | 'deduped' | 'failed' | 'skipped_stale' | 'skipped_unsupported';
  /** Short user-visible result summary. */
  summary?: string;
}

export interface SelfReviewProposalApplyAttempt {
  /** Per-action results in proposal action order. */
  actionResults: SelfReviewProposalActionApplyResult[];
  /** ISO timestamp for this apply attempt. */
  appliedAt: string;
  /** Aggregate apply attempt status. */
  status: 'applied' | 'failed' | 'partially_failed' | 'stale';
}

export interface SelfReviewProposalMetadata {
  /** Frozen proposal actions. */
  actions: SelfReviewProposalAction[];
  /** Dominant action type used for digest grouping and refresh checks. */
  actionType: ActionType;
  /** Historical approve/apply attempts for this proposal. */
  applyAttempts?: SelfReviewProposalApplyAttempt[];
  /** Conflict reason when the proposal cannot be applied as-is. */
  conflictReason?: SelfReviewProposalConflictReason;
  /** ISO timestamp when the proposal was first created. */
  createdAt: string;
  /** Bounded evidence retained at proposal level. */
  evidenceRefs?: EvidenceRef[];
  /** Review evidence window end ISO timestamp. */
  evidenceWindowEnd: string;
  /** Review evidence window start ISO timestamp. */
  evidenceWindowStart: string;
  /** ISO timestamp after which the pending proposal should be ignored or expired. */
  expiresAt: string;
  /** Stable one-pending-proposal key for this target/action pair. */
  proposalKey: string;
  /** Current proposal lifecycle state. */
  status: SelfReviewProposalStatus;
  /** Proposal key or brief id that superseded this proposal. */
  supersededBy?: string;
  /** ISO timestamp for the last proposal lifecycle update. */
  updatedAt: string;
  /** Metadata schema version. */
  version: typeof SELF_REVIEW_PROPOSAL_VERSION;
}

export interface SelfReviewProposalBriefMetadata {
  /** Namespaced Agent Signal metadata stored inside Daily Brief metadata. */
  agentSignal?: {
    /** Nightly self-review metadata owned by Agent Signal. */
    nightlySelfReview?: {
      /** Frozen self-review proposal state for approve/dismiss flows. */
      selfReviewProposal?: SelfReviewProposalMetadata;
    };
  };
}

export const AGENT_SIGNAL_PROPOSAL_BRIEF_ACTIONS = [
  { key: 'approve', label: 'Apply', type: 'resolve' },
  { key: 'dismiss', label: 'Dismiss', type: 'resolve' },
  { key: 'feedback', label: 'Request changes', type: 'comment' },
] satisfies BriefAction[];

/** Daily Brief actions for nightly self-review proposal cards. */
export const AGENT_SIGNAL_SELF_REVIEW_PROPOSAL_BRIEF_ACTIONS = AGENT_SIGNAL_PROPOSAL_BRIEF_ACTIONS;

const EvidenceRefSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    type: z.enum([
      'topic',
      'message',
      'operation',
      'source',
      'receipt',
      'tool_call',
      'task',
      'agent_document',
      'memory',
    ]),
  })
  .passthrough();

const SelfReviewProposalBaseSnapshotSchema = z
  .object({
    absent: z.boolean().optional(),
    agentDocumentId: z.string().optional(),
    contentHash: z.string().optional(),
    documentId: z.string().optional(),
    documentUpdatedAt: z.string().optional(),
    managed: z.boolean().optional(),
    skillName: z.string().optional(),
    targetTitle: z.string().optional(),
    targetType: z.literal('skill').optional(),
    writable: z.boolean().optional(),
  })
  .passthrough();

const SelfReviewProposalActionSchema = z
  .object({
    actionType: z.enum(SELF_ITERATION_ACTION_TYPES),
    baseSnapshot: SelfReviewProposalBaseSnapshotSchema.optional(),
    evidenceRefs: z.array(EvidenceRefSchema),
    idempotencyKey: z.string(),
    operation: z.unknown().optional(),
    rationale: z.string(),
    risk: z.enum(SELF_ITERATION_RISKS),
    target: z.unknown().optional(),
  })
  .passthrough();

const SelfReviewProposalMetadataSchema = z
  .object({
    actions: z.array(SelfReviewProposalActionSchema),
    actionType: z.enum(SELF_ITERATION_ACTION_TYPES),
    applyAttempts: z.unknown().optional(),
    conflictReason: z.unknown().optional(),
    createdAt: z.string(),
    evidenceRefs: z.array(EvidenceRefSchema).optional(),
    evidenceWindowEnd: z.string(),
    evidenceWindowStart: z.string(),
    expiresAt: z.string(),
    proposalKey: z.string(),
    status: z.enum(SELF_REVIEW_PROPOSAL_STATUSES),
    supersededBy: z.string().optional(),
    updatedAt: z.string(),
    version: z.literal(SELF_REVIEW_PROPOSAL_VERSION),
  })
  .passthrough();

const getMergeableProposalSnapshotError = (action: SelfReviewProposalActionPlan) =>
  `Mergeable proposal action requires a complete base snapshot. actionType=${action.actionType}`;

const isMergeableProposalAction = (actionType: string) =>
  actionType === 'create_skill' || actionType === 'refine_skill';

const hasRequiredString = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

const hasCompleteMergeableSnapshot = (
  actionType: string,
  snapshot: SelfReviewProposalBaseSnapshot | undefined,
) => {
  if (!snapshot || snapshot.targetType !== 'skill') return false;

  if (actionType === 'refine_skill') {
    return (
      hasRequiredString(snapshot.agentDocumentId) &&
      hasRequiredString(snapshot.documentId) &&
      hasRequiredString(snapshot.contentHash) &&
      snapshot.managed === true &&
      snapshot.writable === true
    );
  }

  if (actionType === 'create_skill') {
    return snapshot.absent === true && hasRequiredString(snapshot.skillName);
  }

  return false;
};

/**
 * Builds the stable proposal key for one target/action pair.
 *
 * Use when:
 * - A nightly review creates or refreshes a pending proposal
 * - Proposal digest logic needs to group compatible incoming changes
 *
 * Expects:
 * - `targetId` is stable inside `targetType`
 * - Callers choose the most specific target type available
 *
 * Returns:
 * - A colon-delimited key stable across retries for the same proposal target
 */
export const buildSelfReviewProposalKey = ({
  actionType,
  agentId,
  targetId,
  targetType,
}: BuildSelfReviewProposalKeyInput) => [agentId, actionType, targetType, targetId].join(':');

/**
 * Calculates the next expiry for a pending proposal.
 *
 * Use when:
 * - A nightly review creates a proposal
 * - A compatible pending proposal is refreshed by new evidence
 *
 * Expects:
 * - `createdAt` and `now` are valid ISO timestamps
 *
 * Returns:
 * - `now + 72h`, capped at `createdAt + 7d`
 */
export const getNextProposalExpiry = ({ createdAt, now }: { createdAt: string; now: string }) => {
  const nowMs = new Date(now).getTime();
  const createdMs = new Date(createdAt).getTime();
  const slidingMs = nowMs + 72 * 60 * 60 * 1000;
  const hardCapMs = createdMs + 7 * 24 * 60 * 60 * 1000;

  return new Date(Math.min(slidingMs, hardCapMs)).toISOString();
};

/**
 * Checks whether unknown Daily Brief metadata contains proposal metadata.
 *
 * Use when:
 * - Brief feeds need to distinguish Agent Signal proposal briefs
 * - Apply/dismiss paths load serialized metadata from storage
 *
 * Expects:
 * - The value may be arbitrary JSON-like data
 *
 * Returns:
 * - `true` only when required proposal metadata fields are present
 */
export const isSelfReviewProposalMetadata = (value: unknown): value is SelfReviewProposalMetadata =>
  SelfReviewProposalMetadataSchema.safeParse(value).success;

/**
 * Reads proposal metadata from a Daily Brief metadata object.
 *
 * Use when:
 * - Brief approve/dismiss paths need the stored self-review proposal
 * - Proposal digest collectors inspect unresolved Agent Signal briefs
 *
 * Expects:
 * - `metadata` may be arbitrary persisted JSON
 *
 * Returns:
 * - Parsed proposal metadata when present, otherwise `undefined`
 */
export const getSelfReviewProposalFromBriefMetadata = (
  metadata: unknown,
): SelfReviewProposalMetadata | undefined => {
  if (!metadata || typeof metadata !== 'object') return;

  const payload = metadata as SelfReviewProposalBriefMetadata;
  const proposal = payload.agentSignal?.nightlySelfReview?.selfReviewProposal;

  return isSelfReviewProposalMetadata(proposal) ? proposal : undefined;
};

const getProposalTarget = (
  action: ActionPlan,
): Pick<BuildSelfReviewProposalKeyInput, 'targetId' | 'targetType'> => {
  if (action.target?.skillDocumentId) {
    return { targetId: action.target.skillDocumentId, targetType: 'agent_document' };
  }
  if (action.target?.memoryId) return { targetId: action.target.memoryId, targetType: 'memory' };
  if (action.target?.skillName) return { targetId: action.target.skillName, targetType: 'skill' };

  return { targetId: action.dedupeKey, targetType: 'unknown' };
};

const getOperationTargetTitle = (action: ActionPlan) => {
  if (action.operation?.domain !== 'skill') return;

  const { input } = action.operation;

  if ('title' in input && input.title) return input.title;
  if ('name' in input && input.name) return input.name;
};

const getProposalBaseSnapshot = (
  action: SelfReviewProposalActionPlan,
): SelfReviewProposalBaseSnapshot | undefined => {
  if (isMergeableProposalAction(action.actionType)) {
    if (!hasCompleteMergeableSnapshot(action.actionType, action.baseSnapshot)) {
      throw new Error(getMergeableProposalSnapshotError(action));
    }

    return action.baseSnapshot;
  }

  const targetTitle = getOperationTargetTitle(action) ?? action.target?.skillName;

  return action.baseSnapshot ?? (targetTitle ? { targetTitle } : undefined);
};

export interface BuildSelfReviewProposalFromPlanInput {
  /** Agent whose nightly review produced the proposal. */
  agentId: string;
  /** Evidence window end ISO timestamp. */
  evidenceWindowEnd: string;
  /** Evidence window start ISO timestamp. */
  evidenceWindowStart: string;
  /** Stable timestamp to use for created/updated proposal metadata. */
  now: string;
  /** Snapshot-aware self-iteration plan generated before proposal projection. */
  plan: SelfReviewProposalPlan;
  /** Execution results that identify which actions stayed proposed. */
  results: ActionResult[];
}

/**
 * Builds proposal metadata from a self-iteration plan and execution results.
 *
 * Use when:
 * - A nightly review projected a user-visible proposal Daily Brief
 * - Approve-time application needs frozen actions instead of rerunning review
 *
 * Expects:
 * - `results` uses the same idempotency keys as `plan.actions`
 * - Only `proposed` execution results should become frozen proposal actions
 *
 * Returns:
 * - Proposal metadata for the first proposed target/action group, or `undefined`
 */
export const buildSelfReviewProposalFromPlan = ({
  agentId,
  evidenceWindowEnd,
  evidenceWindowStart,
  now,
  plan,
  results,
}: BuildSelfReviewProposalFromPlanInput): SelfReviewProposalMetadata | undefined => {
  const proposedResultKeys = new Set(
    results
      .filter((result) => result.status === ActionStatus.Proposed)
      .map((result) => result.idempotencyKey),
  );
  const proposedActions = plan.actions.filter(
    (action) =>
      action.actionType !== 'noop' &&
      action.actionType !== 'proposal_only' &&
      proposedResultKeys.has(action.idempotencyKey),
  );

  if (proposedActions.length === 0) return;

  const [firstAction] = proposedActions;
  const target = getProposalTarget(firstAction);
  const proposalKey = buildSelfReviewProposalKey({
    actionType: firstAction.actionType,
    agentId,
    targetId: target.targetId,
    targetType: target.targetType,
  });
  const evidenceRefs = new Map<string, EvidenceRef>();

  for (const action of proposedActions) {
    for (const evidenceRef of action.evidenceRefs) {
      evidenceRefs.set(`${evidenceRef.type}:${evidenceRef.id}`, evidenceRef);
    }
  }

  return {
    actionType: firstAction.actionType,
    actions: proposedActions.map((action) => {
      const baseSnapshot = getProposalBaseSnapshot(action);

      return {
        actionType: action.actionType,
        ...(baseSnapshot ? { baseSnapshot } : {}),
        evidenceRefs: action.evidenceRefs,
        idempotencyKey: action.idempotencyKey,
        ...(action.operation ? { operation: action.operation } : {}),
        rationale: action.rationale,
        risk: action.risk,
        ...(action.target ? { target: action.target } : {}),
      };
    }),
    createdAt: now,
    evidenceRefs: [...evidenceRefs.values()],
    evidenceWindowEnd,
    evidenceWindowStart,
    expiresAt: getNextProposalExpiry({ createdAt: now, now }),
    proposalKey,
    status: 'pending',
    updatedAt: now,
    version: SELF_REVIEW_PROPOSAL_VERSION,
  };
};

/**
 * Decides whether a compatible incoming proposal should refresh an existing one.
 *
 * Use when:
 * - A nightly review sees evidence for a target with an existing pending proposal
 * - Proposal creation needs to avoid duplicate unresolved briefs
 *
 * Expects:
 * - `now` is the comparison timestamp for expiry checks
 *
 * Returns:
 * - `{ refresh: true }` only for same-key, same-action, unexpired pending proposals
 */
export const shouldRefreshSelfReviewProposal = ({
  existing,
  incoming,
  now,
}: {
  existing: Pick<
    SelfReviewProposalMetadata,
    'actionType' | 'expiresAt' | 'proposalKey' | 'status'
  > &
    Partial<SelfReviewProposalMetadata>;
  incoming: { actionType: ActionType; proposalKey: string };
  now: string;
}) => {
  if (existing.status !== 'pending') return { refresh: false, reason: 'not_pending' as const };
  if (new Date(existing.expiresAt).getTime() <= new Date(now).getTime()) {
    return { refresh: false, reason: 'expired' as const };
  }
  if (existing.proposalKey !== incoming.proposalKey) {
    return { refresh: false, reason: 'different_key' as const };
  }
  if (existing.actionType && existing.actionType !== incoming.actionType) {
    return { refresh: false, reason: 'different_action' as const };
  }

  return { refresh: true };
};

const getActionTargetSignature = (
  action: Pick<SelfReviewProposalAction, 'operation' | 'target'>,
) => {
  if (action.target?.skillDocumentId) return `skillDocumentId:${action.target.skillDocumentId}`;
  if (action.target?.memoryId) return `memoryId:${action.target.memoryId}`;
  if (action.target?.skillName) return `skillName:${action.target.skillName}`;
  if (action.operation?.domain === 'skill' && 'skillDocumentId' in action.operation.input) {
    return `skillDocumentId:${action.operation.input.skillDocumentId}`;
  }
  if (action.operation?.domain === 'memory' && 'content' in action.operation.input) {
    return 'memory:content';
  }

  return 'unknown';
};

const getActionOperationSignature = (action: SelfReviewProposalAction) =>
  [
    action.actionType,
    action.operation?.domain ?? 'none',
    action.operation?.operation ?? 'none',
    getActionTargetSignature(action),
  ].join(':');

/**
 * Checks whether two frozen proposal action lists can refresh the same pending proposal.
 *
 * Use when:
 * - A nightly review proposes a change for a target that already has a pending proposal
 * - Free-form rationale or summaries changed but the underlying operation identity did not
 *
 * Expects:
 * - Caller has already matched proposals by `proposalKey`
 *
 * Returns:
 * - `true` when action type, operation domain/name, and target identity are equivalent
 */
export const areProposalActionsCompatible = (
  existing: SelfReviewProposalAction[],
  incoming: SelfReviewProposalAction[],
) => {
  if (existing.length !== incoming.length) return false;

  return existing.every(
    (action, index) =>
      getActionOperationSignature(action) === getActionOperationSignature(incoming[index]),
  );
};

/**
 * Decides whether an incoming proposal should replace a pending proposal with the same key.
 *
 * Use when:
 * - A nightly review found a same-target proposal whose operation is no longer compatible
 * - The old proposal should become superseded instead of accumulating duplicate pending briefs
 *
 * Expects:
 * - `now` is the comparison timestamp for expiry checks
 *
 * Returns:
 * - `{ supersede: true }` only for same-key, unexpired pending proposals with incompatible actions
 */
export const shouldSupersedeSelfReviewProposal = ({
  existing,
  incoming,
  now,
}: {
  existing: Pick<SelfReviewProposalMetadata, 'actions' | 'expiresAt' | 'proposalKey' | 'status'> &
    Partial<SelfReviewProposalMetadata>;
  incoming: Pick<SelfReviewProposalMetadata, 'actions' | 'proposalKey'>;
  now: string;
}) => {
  if (existing.status !== 'pending') return { supersede: false, reason: 'not_pending' as const };
  if (new Date(existing.expiresAt).getTime() <= new Date(now).getTime()) {
    return { supersede: false, reason: 'expired' as const };
  }
  if (existing.proposalKey !== incoming.proposalKey) {
    return { supersede: false, reason: 'different_key' as const };
  }
  if (areProposalActionsCompatible(existing.actions, incoming.actions)) {
    return { supersede: false, reason: 'compatible' as const };
  }

  return { supersede: true };
};

/**
 * Refreshes a pending proposal with newer evidence while preserving its identity.
 *
 * Use when:
 * - A compatible nightly proposal repeats before the pending proposal expires
 * - The existing Daily Brief should remain the single user-visible proposal
 *
 * Expects:
 * - Existing and incoming proposals have already been checked for compatibility
 *
 * Returns:
 * - Proposal metadata with refreshed actions, evidence window, and sliding expiry
 */
export const refreshSelfReviewProposal = ({
  existing,
  incoming,
  now,
}: {
  existing: SelfReviewProposalMetadata;
  incoming: SelfReviewProposalMetadata;
  now: string;
}): SelfReviewProposalMetadata => ({
  ...existing,
  actions: incoming.actions,
  actionType: incoming.actionType,
  evidenceRefs: incoming.evidenceRefs,
  evidenceWindowEnd: incoming.evidenceWindowEnd,
  evidenceWindowStart: incoming.evidenceWindowStart,
  expiresAt: getNextProposalExpiry({ createdAt: existing.createdAt, now }),
  status: 'pending',
  updatedAt: now,
});

/**
 * Marks a pending proposal as superseded by a newer incompatible proposal.
 *
 * Use when:
 * - The same target receives a new proposal whose operation identity changed
 * - Future nightly reviews need to know why the old proposal stopped being active
 *
 * Expects:
 * - `supersededBy` is a proposal key or brief id for the replacement
 *
 * Returns:
 * - Proposal metadata with terminal `superseded` state
 */
export const supersedeSelfReviewProposal = ({
  existing,
  now,
  supersededBy,
}: {
  existing: SelfReviewProposalMetadata;
  now: string;
  supersededBy: string;
}): SelfReviewProposalMetadata => ({
  ...existing,
  status: 'superseded',
  supersededBy,
  updatedAt: now,
});
