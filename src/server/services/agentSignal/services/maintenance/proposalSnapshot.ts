import type { MaintenanceProposalBaseSnapshot } from './proposal';

/** Persistence adapters required to capture approve-time proposal target snapshots. */
export interface MaintenanceProposalSnapshotAdapters {
  /** Checks whether a stable skill name is still available for the agent and user. */
  isSkillNameAvailable: (input: {
    /** Agent that will own the created skill. */
    agentId: string;
    /** Stable skill name requested by the proposal action. */
    name: string;
    /** User that owns the agent. */
    userId: string;
  }) => Promise<boolean>;
  /** Reads the current managed skill target snapshot by agent document id. */
  readSkillTargetSnapshot: (
    skillDocumentId: string,
  ) => Promise<Omit<MaintenanceProposalBaseSnapshot, 'targetType'> | undefined>;
}

/** Input for capturing a complete proposal base snapshot before merge/apply. */
export interface CaptureMaintenanceProposalSnapshotInput {
  /** Mergeable proposal action type to snapshot. */
  actionType: 'create_skill' | 'refine_skill';
  /** Agent that owns the target skill namespace. */
  agentId: string;
  /** Frozen action input from the proposal operation. */
  input: Record<string, unknown>;
  /** User that owns the target agent. */
  userId: string;
}

const getRequiredStringInput = (
  input: Record<string, unknown>,
  key: string,
  errorMessage: string,
) => {
  const value = input[key];

  if (typeof value === 'string' && value.trim().length > 0) return value.trim();

  throw new Error(errorMessage);
};

const getOptionalStringInput = (input: Record<string, unknown>, key: string) => {
  const value = input[key];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const requireCompleteRefineSkillSnapshot = (
  snapshot: Omit<MaintenanceProposalBaseSnapshot, 'targetType'> | undefined,
): Omit<MaintenanceProposalBaseSnapshot, 'targetType'> => {
  if (!snapshot) throw new Error('Skill target snapshot is required');

  if (!snapshot.agentDocumentId) throw new Error('Skill target agentDocumentId is required');
  if (!snapshot.documentId) throw new Error('Skill target documentId is required');
  if (!snapshot.contentHash) throw new Error('Skill target contentHash is required');
  if (!snapshot.managed) throw new Error('Skill target must be managed');
  if (!snapshot.writable) throw new Error('Skill target must be writable');

  return snapshot;
};

/**
 * Creates the approve-time proposal snapshot service.
 *
 * Use when:
 * - Proposal approval needs to freeze the current merge base before mutation
 * - Skill creation proposals need to reserve an absent target contract
 *
 * Expects:
 * - `refine_skill` input includes a managed skill `skillDocumentId`
 * - `create_skill` input includes a stable skill `name`
 *
 * Returns:
 * - A service that captures complete skill target snapshots for mergeable proposal actions
 */
export const createMaintenanceProposalSnapshotService = (
  adapters: MaintenanceProposalSnapshotAdapters,
) => ({
  captureActionSnapshot: async ({
    actionType,
    agentId,
    input,
    userId,
  }: CaptureMaintenanceProposalSnapshotInput): Promise<MaintenanceProposalBaseSnapshot> => {
    if (actionType === 'refine_skill') {
      const skillDocumentId = getRequiredStringInput(
        input,
        'skillDocumentId',
        'skillDocumentId is required',
      );
      const snapshot = requireCompleteRefineSkillSnapshot(
        await adapters.readSkillTargetSnapshot(skillDocumentId),
      );

      return { ...snapshot, targetType: 'skill' };
    }

    const name = getRequiredStringInput(input, 'name', 'Skill name is required');
    const available = await adapters.isSkillNameAvailable({ agentId, name, userId });

    if (!available) throw new Error('Skill name is already taken');

    return {
      absent: true,
      skillName: name,
      targetTitle: getOptionalStringInput(input, 'title') ?? name,
      targetType: 'skill',
    };
  },
});
