import type { AgentShareConfig } from '@/database/schemas';

/**
 * What a delegated actor is allowed to do against the resource owner's data.
 *
 * Mirrors the share config's permission fields one-for-one, and is a superset
 * of `ShareDataToolPermissions` (`services/aiAgent/shareGate.ts`) so a
 * delegation's grants can be handed straight to `isShareBlockedDataToolCall`
 * without reshaping.
 */
export interface ExecutionGrants {
  /** Mirrors `shareConfig.allowReadMemory`; gates the memory tool. */
  allowReadMemory?: boolean;
  /** Tool whitelist; an empty/missing list allows nothing. */
  enabledToolIds?: string[];
  /** Mirrors `shareConfig.filePermissionConfig`; gates knowledge-base / agent-documents tools. */
  filePermissionConfig?: AgentShareConfig['filePermissionConfig'];
  /** Agent's assigned (`enabled`) knowledge-base ids; scopes `viewKnowledgeBase`'s `id` arg. */
  knowledgeBaseIds?: string[];
}

/**
 * The authorization under which an actor operates on someone else's resources.
 *
 * Present ONLY when the actor is not the resource owner. Its existence is the
 * single, uniform signal that a run is delegated — replacing the previous
 * `agentShare` marker that every layer had to carry and re-check separately.
 */
export interface ExecutionDelegation {
  /** The shared agent this delegation is scoped to. */
  agentId: string;
  /** What the actor may do against the resource owner's data. */
  grants: ExecutionGrants;
  /**
   * The `agentShares.id` this run was authorized against
   * (`AgentShareGate.shareId`). Used to reject reads of rows stamped with a
   * DIFFERENT share instance — the owner may have disabled and re-enabled the
   * share, minting a new id, so a matching `agentId` alone is not authorization.
   */
  shareId: string;
}

/**
 * Who a run executes as.
 *
 * This type exists because "the user id of a run" was previously ONE field
 * (`userId`) conflating two unrelated questions, which is the root cause the
 * agent-share authorization work kept re-discovering:
 *
 * - **actor** — who is driving the run. Attribution, rate limits, and any row
 *   recording "who did this" belong to the actor.
 * - **resourceOwner** — whose rows, credentials, quota and billing the run
 *   reads, writes and charges. Every ownership filter belongs to the owner.
 *
 * For an ordinary run the two are the same person and `delegation` is absent.
 * For a shared-agent visitor run they differ: the visitor is the actor, the
 * share creator is the resource owner, and `delegation` states exactly what the
 * visitor is allowed to reach.
 *
 * Both ids are optional at the type level ONLY because the operation metadata
 * they are derived from is (`RunMetadata.userId`); they are always present on a
 * real authenticated run. The point of the type is not non-nullability — it is
 * that no caller can read a bare "userId" any more without first deciding which
 * of the two questions it is asking.
 */
export interface ExecutionPrincipal {
  /**
   * The identity driving this run. Equals {@link resourceOwnerUserId} unless
   * {@link delegation} is present.
   */
  actorUserId?: string;
  /** Authorization to act on another user's resources. Absent on ordinary runs. */
  delegation?: ExecutionDelegation;
  /**
   * The identity whose data the run operates on and whose balance it spends.
   * This is what every ownership filter (`WHERE user_id = ?`), credential
   * lookup and billing target must use.
   */
  resourceOwnerUserId?: string;
}

/**
 * An {@link ExecutionPrincipal} whose ids are known to be present.
 *
 * Long-lived holders (services constructed once and then used across many
 * operations) narrow to this at their boundary so their internals can read the
 * ids without an optional check at every use. See
 * {@link assertResolvedPrincipal} for why the check belongs at that boundary.
 */
export interface ResolvedExecutionPrincipal extends ExecutionPrincipal {
  actorUserId: string;
  resourceOwnerUserId: string;
}

/**
 * Narrow a principal at a boundary that cannot operate without both ids, and
 * fail closed if it is incomplete.
 *
 * A service that carried a principal with a missing `resourceOwnerUserId` would
 * construct every model it owns with `undefined`, silently widening their
 * `WHERE user_id = ?` filters instead of erroring — so the failure must be
 * raised here, once, rather than discovered as a data leak downstream.
 *
 * @param context - Named in the thrown message so the offending boundary is
 *   identifiable from the error alone.
 */
export const assertResolvedPrincipal = (
  principal: ExecutionPrincipal,
  context: string,
): ResolvedExecutionPrincipal => {
  const { actorUserId, resourceOwnerUserId } = principal;

  if (!actorUserId || !resourceOwnerUserId) {
    throw new Error(
      `${context} requires a complete execution principal (actorUserId + resourceOwnerUserId)`,
    );
  }

  return { ...principal, actorUserId, resourceOwnerUserId };
};

/** An ordinary run: the actor owns everything it touches. */
export const createOwnerPrincipal = (userId?: string): ExecutionPrincipal => ({
  actorUserId: userId,
  resourceOwnerUserId: userId,
});

/**
 * A delegated run: `actorUserId` drives it, but it reads, writes and bills
 * against `resourceOwnerUserId`, limited to `delegation.grants`.
 */
export const createDelegatedPrincipal = (params: {
  actorUserId: string;
  delegation: ExecutionDelegation;
  resourceOwnerUserId?: string;
}): ExecutionPrincipal => ({
  actorUserId: params.actorUserId,
  delegation: params.delegation,
  resourceOwnerUserId: params.resourceOwnerUserId,
});

/**
 * Build a principal from the run's stored owner id plus the optional share
 * marker persisted in the operation metadata. The single adapter between the
 * legacy `(userId, agentShare)` pair and the principal — nothing else should
 * reconstruct a principal from those two fields.
 */
export const resolveRunPrincipal = (params: {
  agentShare?: {
    agentId: string;
    allowReadMemory?: boolean;
    enabledToolIds?: string[];
    filePermissionConfig?: AgentShareConfig['filePermissionConfig'];
    knowledgeBaseIds?: string[];
    shareId: string;
    visitorUserId: string;
  };
  /** The run's resource owner — historically `metadata.userId`. */
  userId?: string;
}): ExecutionPrincipal => {
  const { agentShare, userId } = params;

  if (!agentShare) return createOwnerPrincipal(userId);

  return createDelegatedPrincipal({
    actorUserId: agentShare.visitorUserId,
    delegation: {
      agentId: agentShare.agentId,
      grants: {
        allowReadMemory: agentShare.allowReadMemory,
        enabledToolIds: agentShare.enabledToolIds,
        filePermissionConfig: agentShare.filePermissionConfig,
        knowledgeBaseIds: agentShare.knowledgeBaseIds,
      },
      shareId: agentShare.shareId,
    },
    resourceOwnerUserId: userId,
  });
};

/**
 * Whether the run operates on resources its actor does not own. The only
 * legitimate reason to branch on this is POLICY — suppressing a side-effect
 * that would land in the owner's account (Agent Signal writes, sub-agent
 * dispatch). Never branch on it to decide which user id to filter by: that
 * answer is always {@link ExecutionPrincipal.resourceOwnerUserId}.
 */
export const isDelegatedRun = (principal: ExecutionPrincipal): boolean => !!principal.delegation;

/**
 * Boundary adapter to the `{ agentId, visitorUserId }` marker that downstream
 * services still take as their own parameter — LLM/embedding billing
 * (`buildAgentShareModelRuntimeContext`), image generation's `AuthContext`,
 * Agent Signal's `EmitToolOutcomeInput`, `KnowledgeBaseSearchService`.
 *
 * Those services are not on the principal yet; this keeps exactly one
 * conversion point instead of each call site rebuilding the pair by hand.
 * Returns `undefined` for an ordinary run, which is what every consumer
 * already treats as "bill/attribute normally".
 */
export const toDelegationMarker = (
  principal: ExecutionPrincipal,
): { agentId?: string; visitorUserId?: string } | undefined =>
  principal.delegation
    ? // Emit the marker whenever a delegation exists, even with a missing
      // `actorUserId`. A half-built marker means the upstream wiring is broken,
      // and the consumers' own fail-closed checks (e.g.
      // `buildAgentShareModelRuntimeContext` throws on a missing
      // agentId/visitorUserId) must be the ones to refuse. Collapsing it to
      // `undefined` here would look like "ordinary run" and silently bill the
      // creator personally for a visitor's inference.
      { agentId: principal.delegation.agentId, visitorUserId: principal.actorUserId }
    : undefined;
