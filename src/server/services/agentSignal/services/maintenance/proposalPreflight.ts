import type { MaintenanceProposalAction, MaintenanceProposalConflictReason } from './proposal';

export type MaintenanceProposalPreflightReason = MaintenanceProposalConflictReason | 'unsupported';

/** Snapshot of a managed skill target used for approve-time freshness checks. */
export interface MaintenanceProposalSkillTargetSnapshot {
  /** Current agent document binding id. */
  agentDocumentId: string;
  /** Current hash of the skill body or normalized content. */
  contentHash?: string;
  /** Current backing document id. */
  documentId?: string;
  /** Whether the target is still managed by Agent Signal. */
  managed: boolean;
  /** Current human-readable title. */
  targetTitle?: string;
  /** Whether the target may still be mutated. */
  writable: boolean;
}

/** Adapters required by proposal apply preflight. */
export interface MaintenanceProposalPreflightAdapters {
  /** Reads current managed skill target state by agent document id. */
  readSkillTarget: (
    agentDocumentId: string,
  ) => Promise<MaintenanceProposalSkillTargetSnapshot | undefined>;
}

/** Successful proposal preflight result. */
export interface MaintenanceProposalPreflightAllowed {
  /** Whether the action may still be applied. */
  allowed: true;
}

/** Failed proposal preflight result with conflict reason. */
export interface MaintenanceProposalPreflightDenied {
  /** Whether the action may still be applied. */
  allowed: false;
  /** Conflict reason recorded on stale or unsupported proposal actions. */
  reason: MaintenanceProposalPreflightReason;
}

export type MaintenanceProposalPreflightResult =
  | MaintenanceProposalPreflightAllowed
  | MaintenanceProposalPreflightDenied;

/**
 * Creates approve-time preflight checks for frozen maintenance proposal actions.
 *
 * Use when:
 * - A user approves a Daily Brief maintenance proposal
 * - The merge path must detect stale, deleted, readonly, or retargeted skill documents first
 *
 * Expects:
 * - Proposal actions include the base snapshot captured when the proposal was created
 * - `readSkillTarget` returns current truth for the same user/agent boundary
 *
 * Returns:
 * - A service that accepts unchanged `refine_skill` targets and rejects drifted targets
 */
export const createMaintenanceProposalPreflightService = (
  adapters: MaintenanceProposalPreflightAdapters,
) => ({
  checkAction: async (
    action: MaintenanceProposalAction,
  ): Promise<MaintenanceProposalPreflightResult> => {
    if (action.actionType !== 'refine_skill') {
      return { allowed: false, reason: 'unsupported' };
    }

    const targetId = action.target?.skillDocumentId;
    if (!targetId || !action.baseSnapshot) {
      return { allowed: false, reason: 'target_deleted' };
    }

    const current = await adapters.readSkillTarget(targetId);
    if (!current) {
      return { allowed: false, reason: 'target_deleted' };
    }

    if (!current.writable || !current.managed) {
      return { allowed: false, reason: 'target_not_writable' };
    }

    if (action.baseSnapshot.documentId && current.documentId !== action.baseSnapshot.documentId) {
      return { allowed: false, reason: 'target_type_changed' };
    }

    if (
      action.baseSnapshot.contentHash &&
      current.contentHash !== action.baseSnapshot.contentHash
    ) {
      return { allowed: false, reason: 'document_changed' };
    }

    return { allowed: true };
  },
});
