import type { AgentRunActor, AgentRunIdentity, AgentState } from '@lobechat/agent-runtime';
import type { AgentShareVisitorContext } from '@lobechat/types';
import { z } from 'zod';

import type { AgentOperationMetadata } from './AgentStateManager';

export const RUN_IDENTITY_VERSION = 1;

/** Key of the snapshot in the durable `agent_operations.metadata`. */
export const RUN_IDENTITY_METADATA_KEY = 'runIdentity';

const idSchema = z.string().min(1);

const runIdentitySchema = z.object({
  actor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), userId: idSchema }),
    z.object({ kind: z.literal('shareVisitor'), shareId: idSchema.optional(), userId: idSchema }),
  ]),
  owner: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: idSchema }),
    z.object({ type: z.literal('workspace'), workspaceId: idSchema }),
  ]),
  version: z.literal(RUN_IDENTITY_VERSION),
});

/**
 * What an operation's other records say about who operates it: derives the
 * actor of an operation without a snapshot, and cross-checks one that has it.
 */
export interface RunIdentityRecord {
  /**
   * The visitor the record marks the run as streaming to. `null` when the
   * record always carries it for a share-visitor run, so its absence means an
   * ordinary run; `undefined` when the record cannot tell (a request body only
   * some callers fill in).
   */
  shareVisitorUserId?: string | null;
  /** The user the operation's services execute as. */
  userId?: string | null;
}

export type RunActorResolution =
  | {
      actor: AgentRunActor;
      ok: true;
      /** `record` when derived from an operation created without a snapshot. */
      source: 'record' | 'snapshot';
    }
  | {
      ok: false;
      /**
       * `missing`: neither a snapshot nor a record to derive from — what
       * readers treated as an unknown operation before. The rest mean the
       * snapshot cannot be trusted.
       */
      reason: 'conflict' | 'invalid' | 'missing' | 'unsupported_version';
    };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Stamp the identity of a new operation. `userId` is the user its services
 * execute as and `workspaceId` the tenant they are scoped to, so a share run
 * is owned by the creator (or their workspace) and operated by the visitor.
 */
export const buildRunIdentity = ({
  shareVisitor,
  userId,
  workspaceId,
}: {
  shareVisitor?: Pick<AgentShareVisitorContext, 'shareId' | 'visitorUserId'>;
  userId: string;
  workspaceId?: string | null;
}): AgentRunIdentity => ({
  actor: shareVisitor
    ? { kind: 'shareVisitor', shareId: shareVisitor.shareId, userId: shareVisitor.visitorUserId }
    : { kind: 'user', userId },
  owner: workspaceId ? { type: 'workspace', workspaceId } : { type: 'user', userId },
  version: RUN_IDENTITY_VERSION,
});

/**
 * Who operates an operation, read from its {@link AgentRunIdentity} snapshot.
 * Servers decide share-visitor handling through here instead of each
 * inferring it from `streamOwnerUserId`.
 *
 * An operation created before the snapshot existed, or by a worker still on
 * the previous build, has none: its actor is derived from the fields it was
 * created with, which is exactly what every reader inferred before. A snapshot
 * that contradicts those fields, or one in a version this build does not know,
 * is refused rather than guessed at, and the caller fails closed.
 */
export const resolveRunActor = (
  snapshot: unknown,
  record: RunIdentityRecord,
): RunActorResolution => {
  const { shareVisitorUserId, userId } = record;

  if (snapshot === undefined || snapshot === null) {
    if (isNonEmptyString(shareVisitorUserId)) {
      return {
        actor: { kind: 'shareVisitor', userId: shareVisitorUserId },
        ok: true,
        source: 'record',
      };
    }
    if (isNonEmptyString(userId)) {
      return { actor: { kind: 'user', userId }, ok: true, source: 'record' };
    }
    return { ok: false, reason: 'missing' };
  }

  const version = (snapshot as { version?: unknown }).version;
  if (typeof version === 'number' && version !== RUN_IDENTITY_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }

  const parsed = runIdentitySchema.safeParse(snapshot);
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const { actor } = parsed.data;
  // Cross-check the facts readers acted on before the snapshot existed. The
  // share marker decides redaction and visitor-row visibility.
  const snapshotVisitor = actor.kind === 'shareVisitor' ? actor.userId : null;
  if (shareVisitorUserId !== undefined && (shareVisitorUserId || null) !== snapshotVisitor) {
    return { ok: false, reason: 'conflict' };
  }
  // An ordinary run's actor is granted its stream and Gateway channel, so it
  // must be the user the operation executes as.
  if (actor.kind === 'user' && isNonEmptyString(userId) && actor.userId !== userId) {
    return { ok: false, reason: 'conflict' };
  }

  return { actor, ok: true, source: 'snapshot' };
};

/**
 * Resolve from the coordinator's operation metadata, which carries the
 * `streamOwnerUserId` mirror for every share-visitor run it records.
 */
export const resolveRunActorFromMetadata = (
  metadata:
    Pick<AgentOperationMetadata, 'identity' | 'streamOwnerUserId' | 'userId'> | null | undefined,
): RunActorResolution =>
  resolveRunActor(metadata?.identity, {
    shareVisitorUserId: metadata?.streamOwnerUserId || null,
    userId: metadata?.userId,
  });

/**
 * Resolve from a runtime state, whose `principal.actor.shareVisitor` grants
 * are present on every share-visitor run.
 */
export const resolveRunActorFromState = (
  state: Pick<AgentState, 'origin' | 'principal'>,
): RunActorResolution =>
  resolveRunActor(state.principal?.identity, {
    shareVisitorUserId: state.principal?.actor?.shareVisitor?.visitorUserId || null,
    userId: state.origin?.userId,
  });

/**
 * Whether the run is operated by a share visitor — so its queries must see
 * visitor-owned rows, and what it streams must be redacted.
 */
export const isShareVisitorActor = (actor: AgentRunActor): boolean => actor.kind === 'shareVisitor';
