import type { BriefAction } from '@lobechat/types';

import type {
  EvidenceRef,
  MaintenanceActionPlan,
  MaintenanceActionResult,
  MaintenanceActionTarget,
  MaintenanceActionType,
  MaintenancePlan,
} from './types';
import { MaintenanceActionStatus, MaintenanceRisk } from './types';

export const MAINTENANCE_PROPOSAL_VERSION = 1;

export type MaintenanceProposalStatus =
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

const MAINTENANCE_ACTION_TYPES = [
  'write_memory',
  'create_skill',
  'refine_skill',
  'consolidate_skill',
  'noop',
  'proposal_only',
] as const satisfies MaintenanceActionType[];

const MAINTENANCE_PROPOSAL_STATUSES = [
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
] as const satisfies MaintenanceProposalStatus[];

const MAINTENANCE_RISKS = [
  MaintenanceRisk.High,
  MaintenanceRisk.Low,
  MaintenanceRisk.Medium,
] as const satisfies MaintenanceRisk[];

export type MaintenanceProposalConflictReason =
  | 'agent_gate_disabled'
  | 'document_changed'
  | 'target_deleted'
  | 'target_not_writable'
  | 'target_type_changed'
  | 'user_gate_disabled'
  | 'server_gate_disabled';

export interface BuildMaintenanceProposalKeyInput {
  /** Action category represented by the proposal. */
  actionType: MaintenanceActionType;
  /** Agent whose self-review produced the proposal. */
  agentId: string;
  /** Stable target id inside the selected target type. */
  targetId: string;
  /** Target namespace used to avoid collisions across resource tables. */
  targetType: 'agent_document' | 'memory' | 'skill' | 'unknown';
}

export interface MaintenanceProposalBaseSnapshot {
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
  /** Human-readable target title observed at proposal time. */
  targetTitle?: string;
  /** Whether the target was writable at proposal time. */
  writable?: boolean;
}

export interface MaintenanceProposalAction {
  /** Planned action type frozen into the proposal. */
  actionType: MaintenanceActionType;
  /** Optional target freshness snapshot used by approve-time preflight. */
  baseSnapshot?: MaintenanceProposalBaseSnapshot;
  /** Bounded evidence references retained for audit and prompt context. */
  evidenceRefs: EvidenceRef[];
  /** Stable operation idempotency key from the original maintenance plan. */
  idempotencyKey: string;
  /** Frozen domain operation to apply after user approval when still fresh. */
  operation?: MaintenanceActionPlan['operation'];
  /** Reviewer rationale shown to users and future maintenance runs. */
  rationale: string;
  /** Risk assigned by the maintenance planner. */
  risk: MaintenanceRisk;
  /** Bounded target identity from the original plan. */
  target?: MaintenanceActionTarget;
}

export interface MaintenanceProposalActionApplyResult {
  /** Frozen action idempotency key this apply result belongs to. */
  idempotencyKey: string;
  /** Resource id touched by the action when one exists. */
  resourceId?: string;
  /** Apply status emitted by the approve-time merge path. */
  status: 'applied' | 'deduped' | 'failed' | 'skipped_stale' | 'skipped_unsupported';
  /** Short user-visible result summary. */
  summary?: string;
}

export interface MaintenanceProposalApplyAttempt {
  /** Per-action results in proposal action order. */
  actionResults: MaintenanceProposalActionApplyResult[];
  /** ISO timestamp for this apply attempt. */
  appliedAt: string;
  /** Aggregate apply attempt status. */
  status: 'applied' | 'failed' | 'partially_failed' | 'stale';
}

export interface MaintenanceProposalMetadata {
  /** Frozen proposal actions. */
  actions: MaintenanceProposalAction[];
  /** Dominant action type used for digest grouping and refresh checks. */
  actionType: MaintenanceActionType;
  /** Historical approve/apply attempts for this proposal. */
  applyAttempts?: MaintenanceProposalApplyAttempt[];
  /** Conflict reason when the proposal cannot be applied as-is. */
  conflictReason?: MaintenanceProposalConflictReason;
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
  status: MaintenanceProposalStatus;
  /** Proposal key or brief id that superseded this proposal. */
  supersededBy?: string;
  /** ISO timestamp for the last proposal lifecycle update. */
  updatedAt: string;
  /** Metadata schema version. */
  version: typeof MAINTENANCE_PROPOSAL_VERSION;
}

export interface MaintenanceProposalBriefMetadata {
  /** Agent Signal maintenance proposal metadata stored inside Daily Brief metadata. */
  proposal?: MaintenanceProposalMetadata;
}

export const AGENT_SIGNAL_PROPOSAL_BRIEF_ACTIONS = [
  { key: 'approve', label: 'Apply', type: 'resolve' },
  { key: 'dismiss', label: 'Dismiss', type: 'resolve' },
  { key: 'feedback', label: 'Request changes', type: 'comment' },
] satisfies BriefAction[];

const isEvidenceRefArray = (value: unknown): value is EvidenceRef[] =>
  Array.isArray(value) &&
  value.every((item) => {
    if (!item || typeof item !== 'object') return false;

    const evidenceRef = item as Record<string, unknown>;

    return typeof evidenceRef.id === 'string' && typeof evidenceRef.type === 'string';
  });

const isKnownStringValue = <TValue extends string>(
  value: unknown,
  allowedValues: readonly TValue[],
): value is TValue => typeof value === 'string' && allowedValues.includes(value as TValue);

const isMaintenanceProposalAction = (value: unknown): value is MaintenanceProposalAction => {
  if (!value || typeof value !== 'object') return false;

  const action = value as Record<string, unknown>;

  return (
    isKnownStringValue(action.actionType, MAINTENANCE_ACTION_TYPES) &&
    isEvidenceRefArray(action.evidenceRefs) &&
    typeof action.idempotencyKey === 'string' &&
    typeof action.rationale === 'string' &&
    isKnownStringValue(action.risk, MAINTENANCE_RISKS)
  );
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
export const buildMaintenanceProposalKey = ({
  actionType,
  agentId,
  targetId,
  targetType,
}: BuildMaintenanceProposalKeyInput) => [agentId, actionType, targetType, targetId].join(':');

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
export const isMaintenanceProposalMetadata = (
  value: unknown,
): value is MaintenanceProposalMetadata => {
  if (!value || typeof value !== 'object') return false;

  const payload = value as Record<string, unknown>;

  return (
    payload.version === MAINTENANCE_PROPOSAL_VERSION &&
    isKnownStringValue(payload.actionType, MAINTENANCE_ACTION_TYPES) &&
    typeof payload.proposalKey === 'string' &&
    isKnownStringValue(payload.status, MAINTENANCE_PROPOSAL_STATUSES) &&
    typeof payload.createdAt === 'string' &&
    typeof payload.updatedAt === 'string' &&
    typeof payload.expiresAt === 'string' &&
    typeof payload.evidenceWindowStart === 'string' &&
    typeof payload.evidenceWindowEnd === 'string' &&
    (payload.evidenceRefs === undefined || isEvidenceRefArray(payload.evidenceRefs)) &&
    Array.isArray(payload.actions) &&
    payload.actions.every(isMaintenanceProposalAction)
  );
};

/**
 * Reads proposal metadata from a Daily Brief metadata object.
 *
 * Use when:
 * - Brief approve/dismiss paths need the stored maintenance proposal
 * - Proposal digest collectors inspect unresolved Agent Signal briefs
 *
 * Expects:
 * - `metadata` may be arbitrary persisted JSON
 *
 * Returns:
 * - Parsed proposal metadata when present, otherwise `undefined`
 */
export const getMaintenanceProposalFromBriefMetadata = (
  metadata: unknown,
): MaintenanceProposalMetadata | undefined => {
  if (!metadata || typeof metadata !== 'object') return;

  const proposal = (metadata as MaintenanceProposalBriefMetadata).proposal;

  return isMaintenanceProposalMetadata(proposal) ? proposal : undefined;
};

const getProposalTarget = (
  action: MaintenanceActionPlan,
): Pick<BuildMaintenanceProposalKeyInput, 'targetId' | 'targetType'> => {
  if (action.target?.skillDocumentId) {
    return { targetId: action.target.skillDocumentId, targetType: 'agent_document' };
  }
  if (action.target?.memoryId) return { targetId: action.target.memoryId, targetType: 'memory' };
  if (action.target?.skillName) return { targetId: action.target.skillName, targetType: 'skill' };

  return { targetId: action.dedupeKey, targetType: 'unknown' };
};

const getOperationTargetTitle = (action: MaintenanceActionPlan) => {
  if (action.operation?.domain !== 'skill') return;

  const { input } = action.operation;

  if ('title' in input && input.title) return input.title;
  if ('name' in input && input.name) return input.name;
};

const getProposalBaseSnapshot = (
  action: MaintenanceActionPlan,
): MaintenanceProposalBaseSnapshot | undefined => {
  const targetTitle = getOperationTargetTitle(action) ?? action.target?.skillName;

  return targetTitle ? { targetTitle } : undefined;
};

export interface BuildMaintenanceProposalFromPlanInput {
  /** Agent whose nightly review produced the proposal. */
  agentId: string;
  /** Evidence window end ISO timestamp. */
  evidenceWindowEnd: string;
  /** Evidence window start ISO timestamp. */
  evidenceWindowStart: string;
  /** Stable timestamp to use for created/updated proposal metadata. */
  now: string;
  /** Frozen maintenance plan generated before execution. */
  plan: MaintenancePlan;
  /** Execution results that identify which actions stayed proposed. */
  results: MaintenanceActionResult[];
}

/**
 * Builds proposal metadata from a maintenance plan and execution results.
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
export const buildMaintenanceProposalFromPlan = ({
  agentId,
  evidenceWindowEnd,
  evidenceWindowStart,
  now,
  plan,
  results,
}: BuildMaintenanceProposalFromPlanInput): MaintenanceProposalMetadata | undefined => {
  const proposedResultKeys = new Set(
    results
      .filter((result) => result.status === MaintenanceActionStatus.Proposed)
      .map((result) => result.idempotencyKey),
  );
  const proposedActions = plan.actions.filter(
    (action) => action.actionType !== 'noop' && proposedResultKeys.has(action.idempotencyKey),
  );

  if (proposedActions.length === 0) return;

  const [firstAction] = proposedActions;
  const target = getProposalTarget(firstAction);
  const proposalKey = buildMaintenanceProposalKey({
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
    version: MAINTENANCE_PROPOSAL_VERSION,
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
export const shouldRefreshMaintenanceProposal = ({
  existing,
  incoming,
  now,
}: {
  existing: Pick<
    MaintenanceProposalMetadata,
    'actionType' | 'expiresAt' | 'proposalKey' | 'status'
  > &
    Partial<MaintenanceProposalMetadata>;
  incoming: { actionType: MaintenanceActionType; proposalKey: string };
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
  action: Pick<MaintenanceProposalAction, 'operation' | 'target'>,
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

const getActionOperationSignature = (action: MaintenanceProposalAction) =>
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
  existing: MaintenanceProposalAction[],
  incoming: MaintenanceProposalAction[],
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
export const shouldSupersedeMaintenanceProposal = ({
  existing,
  incoming,
  now,
}: {
  existing: Pick<MaintenanceProposalMetadata, 'actions' | 'expiresAt' | 'proposalKey' | 'status'> &
    Partial<MaintenanceProposalMetadata>;
  incoming: Pick<MaintenanceProposalMetadata, 'actions' | 'proposalKey'>;
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
export const refreshMaintenanceProposal = ({
  existing,
  incoming,
  now,
}: {
  existing: MaintenanceProposalMetadata;
  incoming: MaintenanceProposalMetadata;
  now: string;
}): MaintenanceProposalMetadata => ({
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
export const supersedeMaintenanceProposal = ({
  existing,
  now,
  supersededBy,
}: {
  existing: MaintenanceProposalMetadata;
  now: string;
  supersededBy: string;
}): MaintenanceProposalMetadata => ({
  ...existing,
  status: 'superseded',
  supersededBy,
  updatedAt: now,
});
