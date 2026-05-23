import type { SelfReviewProposalBaseSnapshot } from './proposal';

/** Persistence adapters required to capture approve-time proposal target snapshots. */
export interface SelfReviewProposalSnapshotAdapters {
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
  ) => Promise<Omit<SelfReviewProposalBaseSnapshot, 'targetType'> | undefined>;
}

/** Input for capturing a complete proposal base snapshot before merge/apply. */
export interface CaptureSelfReviewProposalSnapshotInput {
  /** Mergeable proposal action type to snapshot. */
  actionType: 'create_skill' | 'refine_skill';
  /** Agent that owns the target skill namespace. */
  agentId: string;
  /** Frozen action input from the proposal operation. */
  input: Record<string, unknown>;
  /** User that owns the target agent. */
  userId: string;
}

const requireCompleteRefineSkillSnapshot = (
  snapshot: Omit<SelfReviewProposalBaseSnapshot, 'targetType'> | undefined,
): Omit<SelfReviewProposalBaseSnapshot, 'targetType'> => {
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
export const createSelfReviewProposalSnapshotService = (
  adapters: SelfReviewProposalSnapshotAdapters,
) => ({
  captureActionSnapshot: async ({
    actionType,
    agentId,
    input,
    userId,
  }: CaptureSelfReviewProposalSnapshotInput): Promise<SelfReviewProposalBaseSnapshot> => {
    if (actionType === 'refine_skill') {
      const value = input.skillDocumentId;
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('skillDocumentId is required');
      }
      const skillDocumentId = value.trim();
      const snapshot = requireCompleteRefineSkillSnapshot(
        await adapters.readSkillTargetSnapshot(skillDocumentId),
      );

      return { ...snapshot, targetType: 'skill' };
    }

    const value = input.name;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('Skill name is required');
    }
    const name = value.trim();
    const available = await adapters.isSkillNameAvailable({ agentId, name, userId });

    if (!available) throw new Error('Skill name is already taken');

    const title = input.title;

    return {
      absent: true,
      skillName: name,
      targetTitle: typeof title === 'string' && title.trim().length > 0 ? title.trim() : name,
      targetType: 'skill',
    };
  },
});
