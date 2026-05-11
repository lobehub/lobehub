import type {
  MaintenanceProposalAction,
  MaintenanceProposalBaseSnapshot,
  MaintenanceProposalConflictReason,
} from './proposal';

export type MaintenanceProposalPreflightReason = MaintenanceProposalConflictReason | 'unsupported';

/** Adapters required by proposal apply preflight. */
export interface MaintenanceProposalPreflightAdapters {
  /** Checks whether a proposed stable skill name is still absent. */
  isSkillNameAvailable: (input: {
    /** Agent namespace when the caller can provide it. */
    agentId?: string;
    /** Stable skill name requested by the proposal. */
    name: string;
    /** User namespace when the caller can provide it. */
    userId?: string;
  }) => Promise<boolean>;
  /** Reads current managed skill target state by agent document id. */
  readSkillTargetSnapshot: (
    skillDocumentId: string,
  ) => Promise<MaintenanceProposalBaseSnapshot | undefined>;
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
 * - Adapters return current truth for the same user/agent boundary
 *
 * Returns:
 * - A service that accepts fresh create/refine skill proposals and rejects stale targets
 */
export const createMaintenanceProposalPreflightService = (
  adapters: MaintenanceProposalPreflightAdapters,
) => ({
  checkAction: async (
    action: MaintenanceProposalAction,
  ): Promise<MaintenanceProposalPreflightResult> => {
    if (action.actionType === 'refine_skill') {
      return checkRefineSkillAction(action, adapters);
    }

    if (action.actionType === 'create_skill') {
      return checkCreateSkillAction(action, adapters);
    }

    if (action.actionType === 'consolidate_skill') {
      return checkConsolidateSkillAction(action, adapters);
    }

    return { allowed: false, reason: 'unsupported' };
  },
});

const hasRequiredString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const getOperationInputString = (action: MaintenanceProposalAction, key: string) => {
  const input = action.operation?.input;

  if (!input || typeof input !== 'object' || !(key in input)) return;

  const record = input as unknown as Record<string, unknown>;
  const value = record[key];

  return hasRequiredString(value) ? value.trim() : undefined;
};

const getOperationInputStringArray = (action: MaintenanceProposalAction, key: string) => {
  const input = action.operation?.input;
  if (!input || typeof input !== 'object' || !(key in input)) return [];

  const record = input as unknown as Record<string, unknown>;
  const value = record[key];

  return Array.isArray(value)
    ? value.flatMap((item) => (hasRequiredString(item) ? [item.trim()] : []))
    : [];
};

const getOperationInputSnapshots = (action: MaintenanceProposalAction, key: string) => {
  const input = action.operation?.input;
  if (!input || typeof input !== 'object' || !(key in input)) return [];

  const record = input as unknown as Record<string, unknown>;
  const value = record[key];

  return Array.isArray(value)
    ? value.flatMap((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? [item as MaintenanceProposalBaseSnapshot]
          : [],
      )
    : [];
};

const isCompleteRefineSnapshot = (
  snapshot: MaintenanceProposalBaseSnapshot,
): snapshot is MaintenanceProposalBaseSnapshot & {
  agentDocumentId: string;
  contentHash: string;
  documentId: string;
} =>
  snapshot.targetType === 'skill' &&
  hasRequiredString(snapshot.agentDocumentId) &&
  hasRequiredString(snapshot.contentHash) &&
  hasRequiredString(snapshot.documentId) &&
  snapshot.managed === true &&
  snapshot.writable === true;

const checkRefineSkillAction = async (
  action: MaintenanceProposalAction,
  adapters: MaintenanceProposalPreflightAdapters,
): Promise<MaintenanceProposalPreflightResult> => {
  const { baseSnapshot } = action;
  if (!baseSnapshot) return { allowed: false, reason: 'snapshot_missing' };
  if (!isCompleteRefineSnapshot(baseSnapshot)) {
    return { allowed: false, reason: 'snapshot_incomplete' };
  }

  if (
    action.target?.skillDocumentId &&
    action.target.skillDocumentId !== baseSnapshot.agentDocumentId
  ) {
    return { allowed: false, reason: 'target_type_changed' };
  }

  const operationSkillDocumentId = getOperationInputString(action, 'skillDocumentId');
  if (operationSkillDocumentId && operationSkillDocumentId !== baseSnapshot.agentDocumentId) {
    return { allowed: false, reason: 'target_type_changed' };
  }

  const current = await adapters.readSkillTargetSnapshot(baseSnapshot.agentDocumentId);
  if (!current) return { allowed: false, reason: 'target_deleted' };

  if (current.managed !== true) return { allowed: false, reason: 'target_unmanaged' };
  if (current.writable !== true) return { allowed: false, reason: 'target_not_writable' };

  if (current.agentDocumentId && current.agentDocumentId !== baseSnapshot.agentDocumentId) {
    return { allowed: false, reason: 'document_changed' };
  }

  if (current.documentId !== baseSnapshot.documentId) {
    return { allowed: false, reason: 'target_type_changed' };
  }

  if (current.contentHash !== baseSnapshot.contentHash) {
    return { allowed: false, reason: 'content_changed' };
  }

  return { allowed: true };
};

const checkCreateSkillAction = async (
  action: MaintenanceProposalAction,
  adapters: MaintenanceProposalPreflightAdapters,
): Promise<MaintenanceProposalPreflightResult> => {
  const { baseSnapshot } = action;
  if (!baseSnapshot) return { allowed: false, reason: 'snapshot_missing' };
  if (
    baseSnapshot.targetType !== 'skill' ||
    baseSnapshot.absent !== true ||
    !hasRequiredString(baseSnapshot.skillName)
  ) {
    return { allowed: false, reason: 'snapshot_incomplete' };
  }

  const skillName = baseSnapshot.skillName.trim();

  if (action.target?.skillName && action.target.skillName !== skillName) {
    return { allowed: false, reason: 'target_type_changed' };
  }

  const operationName = getOperationInputString(action, 'name');
  if (operationName && operationName !== skillName) {
    return { allowed: false, reason: 'target_type_changed' };
  }

  const available = await adapters.isSkillNameAvailable({
    agentId: getOperationInputString(action, 'agentId'),
    name: skillName,
    userId: getOperationInputString(action, 'userId'),
  });

  return available ? { allowed: true } : { allowed: false, reason: 'target_conflict' };
};

const checkSnapshotFresh = async (
  baseSnapshot: MaintenanceProposalBaseSnapshot,
  adapters: MaintenanceProposalPreflightAdapters,
): Promise<MaintenanceProposalPreflightResult> => {
  if (!isCompleteRefineSnapshot(baseSnapshot)) {
    return { allowed: false, reason: 'snapshot_incomplete' };
  }

  const current = await adapters.readSkillTargetSnapshot(baseSnapshot.agentDocumentId);
  if (!current) return { allowed: false, reason: 'target_deleted' };
  if (current.managed !== true) return { allowed: false, reason: 'target_unmanaged' };
  if (current.writable !== true) return { allowed: false, reason: 'target_not_writable' };
  if (current.agentDocumentId && current.agentDocumentId !== baseSnapshot.agentDocumentId) {
    return { allowed: false, reason: 'document_changed' };
  }
  if (current.documentId !== baseSnapshot.documentId) {
    return { allowed: false, reason: 'target_type_changed' };
  }
  if (current.contentHash !== baseSnapshot.contentHash) {
    return { allowed: false, reason: 'content_changed' };
  }

  return { allowed: true };
};

const checkConsolidateSkillAction = async (
  action: MaintenanceProposalAction,
  adapters: MaintenanceProposalPreflightAdapters,
): Promise<MaintenanceProposalPreflightResult> => {
  if (action.operation?.domain !== 'skill' || action.operation.operation !== 'consolidate') {
    return { allowed: false, reason: 'unsupported' };
  }

  const canonicalSkillDocumentId = getOperationInputString(action, 'canonicalSkillDocumentId');
  const sourceSkillIds = getOperationInputStringArray(action, 'sourceSkillIds');
  const sourceSnapshots = getOperationInputSnapshots(action, 'sourceSnapshots');
  const bodyMarkdown = getOperationInputString(action, 'bodyMarkdown');

  if (!canonicalSkillDocumentId || sourceSkillIds.length < 2 || !bodyMarkdown) {
    return { allowed: false, reason: 'snapshot_incomplete' };
  }

  if (!action.baseSnapshot) return { allowed: false, reason: 'snapshot_missing' };
  if (action.baseSnapshot.agentDocumentId !== canonicalSkillDocumentId) {
    return { allowed: false, reason: 'target_type_changed' };
  }

  const canonicalResult = await checkSnapshotFresh(action.baseSnapshot, adapters);
  if (!canonicalResult.allowed) return canonicalResult;

  if (sourceSnapshots.length !== sourceSkillIds.length) {
    return { allowed: false, reason: 'snapshot_incomplete' };
  }

  for (const sourceSnapshot of sourceSnapshots) {
    if (
      !sourceSnapshot.agentDocumentId ||
      !sourceSkillIds.includes(sourceSnapshot.agentDocumentId)
    ) {
      return { allowed: false, reason: 'target_type_changed' };
    }

    const sourceResult = await checkSnapshotFresh(sourceSnapshot, adapters);
    if (!sourceResult.allowed) return sourceResult;
  }

  return { allowed: true };
};
