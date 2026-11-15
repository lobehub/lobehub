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
  /** Reads the current prompt hash for the reviewed agent. */
  readAgentPromptSnapshot?: (agentId: string) => Promise<{ promptHash: string } | undefined>;
  /** Reads the current managed skill target snapshot by agent document id. */
  readSkillTargetSnapshot: (
    skillDocumentId: string,
  ) => Promise<Omit<SelfReviewProposalBaseSnapshot, 'targetType'> | undefined>;
}

/** Input for capturing a complete proposal base snapshot before merge/apply. */
export interface CaptureSelfReviewProposalSnapshotInput {
  /** Mergeable proposal action type to snapshot. */
  actionType: 'create_skill' | 'refine_prompt' | 'refine_skill';
  /** Agent that owns the target skill namespace. */
  agentId: string;
  /** Frozen action input from the proposal operation. */
  input: Record<string, unknown>;
  /** User that owns the target agent. */
  userId: string;
}

const requireCompleteRefineSkillSnapshot = (
  skillDocumentId: string,
  snapshot: Omit<SelfReviewProposalBaseSnapshot, 'targetType'> | undefined,
): Omit<SelfReviewProposalBaseSnapshot, 'targetType'> => {
  if (!snapshot) {
    throw new Error(
      `Skill target snapshot is required: skillDocumentId "${skillDocumentId}" is neither a managed skill nor a hinted skill document of this agent. Use an id returned by listManagedSkills or getManagedSkill.`,
    );
  }

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
    if (actionType === 'refine_prompt') {
      const value = input.agentId;
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('agentId is required');
      }
      const targetAgentId = value.trim();
      const snapshot = await adapters.readAgentPromptSnapshot?.(targetAgentId);
      if (!snapshot?.promptHash) throw new Error('Agent prompt snapshot is required');

      return {
        agentId: targetAgentId,
        promptHash: snapshot.promptHash,
        targetType: 'agent_prompt',
      };
    }

    if (actionType === 'refine_skill') {
      const value = input.skillDocumentId;
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('skillDocumentId is required');
      }
      const skillDocumentId = value.trim();
      const snapshot = requireCompleteRefineSkillSnapshot(
        skillDocumentId,
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

/** Checks whether a caller-provided skill snapshot can serve as a compare-and-set base. */
export const isCompleteSkillTargetSnapshot = (
  snapshot: unknown,
): snapshot is SelfReviewProposalBaseSnapshot & {
  agentDocumentId: string;
  contentHash: string;
  documentId: string;
  targetType: 'skill';
} => {
  if (!snapshot || typeof snapshot !== 'object') return false;

  const value = snapshot as SelfReviewProposalBaseSnapshot;
  const isFilled = (field: unknown) => typeof field === 'string' && field.trim().length > 0;

  return (
    value.targetType === 'skill' &&
    isFilled(value.agentDocumentId) &&
    isFilled(value.contentHash) &&
    isFilled(value.documentId) &&
    value.managed === true &&
    value.writable === true
  );
};

/**
 * Resolves the compare-and-set base and canonical target id for a skill replacement.
 *
 * Use when:
 * - `replaceSkillContentCAS` receives a `skillDocumentId` and an optional `baseSnapshot`
 *
 * Expects:
 * - `baseSnapshot`, when complete, is the snapshot a skill read returned (for example
 *   `getManagedSkill().baseSnapshot`); it stays the base so preflight rejects content drift
 *
 * Returns:
 * - The base snapshot and the target id preflight compares against. A SKILL.md index id
 *   resolves to its bundle id, so a read-by-index snapshot passed unchanged still matches.
 */
export const resolveReplaceSkillBaseSnapshot = async ({
  agentId,
  baseSnapshot,
  skillDocumentId,
  snapshotService,
  userId,
}: {
  agentId: string;
  baseSnapshot: unknown;
  skillDocumentId: string;
  snapshotService: ReturnType<typeof createSelfReviewProposalSnapshotService>;
  userId: string;
}): Promise<{ baseSnapshot: SelfReviewProposalBaseSnapshot; skillDocumentId: string }> => {
  const callerSnapshot = isCompleteSkillTargetSnapshot(baseSnapshot) ? baseSnapshot : undefined;

  let current: SelfReviewProposalBaseSnapshot;
  try {
    current = await snapshotService.captureActionSnapshot({
      actionType: 'refine_skill',
      agentId,
      input: { skillDocumentId },
      userId,
    });
  } catch (error) {
    // A complete caller snapshot whose target vanished is a stale write, not a malformed one:
    // let preflight report `target_deleted` instead of failing the tool call.
    if (callerSnapshot) return { baseSnapshot: callerSnapshot, skillDocumentId };
    throw error;
  }

  return {
    baseSnapshot: callerSnapshot ?? current,
    skillDocumentId: current.agentDocumentId ?? skillDocumentId,
  };
};
