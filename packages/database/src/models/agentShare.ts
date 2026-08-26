import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { isHeterogeneousAgentConfig } from '@lobechat/const';
import type { ChatTopicMetadata, LobeAgentAgencyConfig, ShareVisibility } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, notInArray, or, sql } from 'drizzle-orm';

import type { AgentShareConfig, AgentShareConfigPatch } from '../schemas';
import { agents, agentShareRunReservations, agentShares, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { isUuid } from '../utils/uuid';

/**
 * Builtin agents (Inbox, Agent Builder, Web Onboarding, ...) are per-user
 * provisioned system agents, not agents a user authored and owns to share.
 * `AgentShareModel.ownership` otherwise matches any personal (non-workspace)
 * agent row, and `AgentModel.getBuiltinAgent` creates exactly such a row for
 * every builtin slug on first use — so without this exclusion a user could
 * open `/agent/<builtin-id>/share` and auto-create a resolvable share for it.
 * Some builtin runtimes (e.g. web-onboarding, see
 * `serverCallLlmContextBuilder.ts`) unconditionally inject the owner's
 * persona, SOUL document, and onboarding profile into context regardless of
 * the share's own memory/file permission gates, so this must be blocked at
 * the share boundary itself rather than relying on those gates.
 */
const RESERVED_AGENT_SHARE_SLUGS: string[] = Object.values(BUILTIN_AGENT_SLUGS);

/** Fail-closed guard reused by every ownership/resolution query below. */
const excludeReservedAgentSlug = () =>
  or(isNull(agents.slug), notInArray(agents.slug, RESERVED_AGENT_SHARE_SLUGS));

const DEFAULT_AGENT_SHARE_CONFIG = {
  allowReadMemory: false,
  enabledToolIds: [],
  filePermissionConfig: {
    agentFiles: 'none',
    knowledgeBase: 'none',
    uploadAllowed: false,
  },
  maxTopicsPerVisitor: 5,
  maxTurnsPerTopic: 20,
} satisfies AgentShareConfig;

interface LegacyAgentShareConfig extends AgentShareConfig {
  /** @deprecated Renamed to maxTopicsPerVisitor. */
  maxGuestTopics?: number;
}

/** Fill fields missing from rows created before the required v1 limits were introduced. */
const normalizeAgentShareConfig = (config: AgentShareConfig | null): AgentShareConfig => ({
  allowReadMemory: config?.allowReadMemory ?? DEFAULT_AGENT_SHARE_CONFIG.allowReadMemory,
  enabledToolIds: config?.enabledToolIds ?? DEFAULT_AGENT_SHARE_CONFIG.enabledToolIds,
  filePermissionConfig: {
    agentFiles:
      config?.filePermissionConfig?.agentFiles ??
      DEFAULT_AGENT_SHARE_CONFIG.filePermissionConfig.agentFiles,
    knowledgeBase:
      config?.filePermissionConfig?.knowledgeBase ??
      DEFAULT_AGENT_SHARE_CONFIG.filePermissionConfig.knowledgeBase,
    uploadAllowed:
      config?.filePermissionConfig?.uploadAllowed ??
      DEFAULT_AGENT_SHARE_CONFIG.filePermissionConfig.uploadAllowed,
  },
  maxTopicsPerVisitor:
    config?.maxTopicsPerVisitor ??
    (config as LegacyAgentShareConfig | null)?.maxGuestTopics ??
    DEFAULT_AGENT_SHARE_CONFIG.maxTopicsPerVisitor,
  maxTurnsPerTopic: config?.maxTurnsPerTopic ?? DEFAULT_AGENT_SHARE_CONFIG.maxTurnsPerTopic,
});

export type AgentShareData = NonNullable<
  Awaited<ReturnType<(typeof AgentShareModel)['findByShareId']>>
>;

/** Minimal locked-row snapshot needed by callers of {@link AgentShareModel.withOwnedPersonalAgentLock}. */
interface LockedAgentSnapshot {
  agencyConfig: LobeAgentAgencyConfig | null;
  id: string;
  model: string | null;
}

export class AgentShareModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Agent sharing is personal-only; workspace agents fail this predicate.
   * Reserved builtin slugs also fail it (see `excludeReservedAgentSlug`).
   */
  private ownership = () =>
    exists(
      this.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, agentShares.agentId),
            eq(agents.userId, this.userId),
            isNull(agents.workspaceId),
            excludeReservedAgentSlug(),
          ),
        ),
    );

  /**
   * Serialize share writes with scope transfers by locking the Agent row
   * first, and hand the mutation callback the locked snapshot's `model` /
   * `agencyConfig`.
   *
   * This lock is the SAME physical Agent row that `AgentModel.updateConfig`
   * (packages/database/src/models/agent.ts) locks before writing a config
   * change and conditionally resetting a `link` share back to `private` when
   * the merged config turns heterogeneous. Both sides taking `FOR UPDATE` on
   * `agents.id = agentId` is what makes the two writers serialize instead of
   * interleaving: without it, `updateVisibility('link')` could validate a
   * still-homogeneous config, let a concurrent `updateConfig` reset the share
   * to `private`, then blindly flip it back to `link` — a live share link on
   * a Codex/Claude Code agent whose every visitor send is fail-closed by
   * `AiAgentService`. See LOBE-11930.
   */
  private withOwnedPersonalAgentLock = async <T>(
    agentId: string,
    mutation: (tx: LobeChatDatabase, agent: LockedAgentSnapshot) => Promise<T>,
  ): Promise<T | null> =>
    this.db.transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      const [agent] = await tx
        .select({ agencyConfig: agents.agencyConfig, id: agents.id, model: agents.model })
        .from(agents)
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.userId, this.userId),
            isNull(agents.workspaceId),
            excludeReservedAgentSlug(),
          ),
        )
        .for('update');

      if (!agent) return null;
      return mutation(tx, agent as LockedAgentSnapshot);
    });

  /** Create a private share by default, or return the existing share for the agent. */
  create = async (agentId: string, visibility: ShareVisibility = 'private') => {
    const share = await this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [created] = await tx
        .insert(agentShares)
        .values({ agentId, shareConfig: DEFAULT_AGENT_SHARE_CONFIG, visibility })
        .onConflictDoNothing({ target: agentShares.agentId })
        .returning();

      if (created) return created;

      const [existing] = await tx
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId))
        .limit(1);
      return existing
        ? { ...existing, shareConfig: normalizeAgentShareConfig(existing.shareConfig) }
        : null;
    });

    if (!share) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Agent sharing is only available to personal agent owners',
      });
    }

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /** Get a share by agent ID for its owner. */
  getByAgentId = async (agentId: string) => {
    const [share] = await this.db
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, agentId), this.ownership()))
      .limit(1);

    if (!share) return null;

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /** Atomically merge client-owned fields while preserving sibling and legacy JSON keys. */
  updateConfig = async (agentId: string, config: AgentShareConfigPatch) =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const { filePermissionConfig, ...topLevelConfig } = config;
      const nextConfig = filePermissionConfig
        ? sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify(topLevelConfig)}::jsonb || jsonb_build_object('filePermissionConfig', COALESCE(${agentShares.shareConfig}->'filePermissionConfig', '{}'::jsonb) || ${JSON.stringify(filePermissionConfig)}::jsonb)`
        : sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify(topLevelConfig)}::jsonb`;
      const [updated] = await tx
        .update(agentShares)
        .set({
          shareConfig: nextConfig,
          updatedAt: new Date(),
        })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return updated
        ? { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) }
        : null;
    });

  /**
   * Re-validate a share is still `link` immediately before a visitor run
   * creates its operation, guarded by the SAME `agents.id FOR UPDATE` lock
   * `updateVisibility` / `deleteByAgentId` (revocation) and
   * `writeAgentConfigWithShareReset` (config-triggered reset, see
   * `packages/database/src/utils/agentConfigShareReset.ts`) already take via
   * `withOwnedPersonalAgentLock`.
   *
   * WHY here and not only at `findByShareIdWithAccessCheck`: that check runs
   * once, at the top of `shareChat.execAgent`, long before the operation is
   * actually created — `AiAgentService.execAgentWithReservation` resolves
   * agent config, tools, and knowledge bases, and persists messages in
   * between (thousands of lines of work, including real I/O). A revoke
   * landing in that window used to be invisible to the in-flight request:
   * `interruptActiveShareRuns`'s post-commit query found no
   * `runningOperation` yet (the operation hadn't been created), and the
   * operation created afterwards was then unstoppable by the visitor
   * (`shareChat.interruptTask` re-checks visibility and gets `FORBIDDEN`).
   * Taking the same row lock revocation/reset use forces one strict
   * ordering: whichever side — this recheck, or a concurrent
   * revoke/config-reset — commits its transaction first is the one the other
   * observes. A revoke that already committed is always seen here, so this
   * run fails closed instead of creating an operation the visitor can no
   * longer stop. See LOBE-11930 hole 1.
   *
   * Deliberately narrow: only the `visibility` column is re-read (not
   * `isHeterogeneousAgentConfig`, which `updateVisibility` already enforces
   * on the ONLY path that can set `link`) — a broader check would duplicate
   * `writeAgentConfigWithShareReset`'s own heterogeneity gate and risk
   * drifting from it.
   *
   * This recheck alone only closes the window up to THIS transaction's
   * commit — `createOperation` (gateway init, state persistence, queue
   * scheduling) still runs afterwards, unlocked, and can take arbitrarily
   * long. To close THAT window too, insert the durable
   * `agentShareRunReservations` row in the SAME transaction as the
   * visibility recheck (before releasing the lock), not after: a revoke that
   * commits any time later — seconds or minutes into a slow `createOperation`
   * — will always find and revoke this row (`revokeReservations`), and the
   * run's own `confirmReservation` call, right before it commits to actually
   * running, fails closed if it was. See `agentShareRunReservations`'s JSDoc
   * for why this replaces the previous bounded-retry stopgap.
   */
  assertRunnableForVisitor = async (params: {
    agentId: string;
    operationId: string;
    topicId: string;
    visitorUserId: string;
  }): Promise<void> => {
    const { agentId, operationId, topicId, visitorUserId } = params;

    const runnable = await this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [share] = await tx
        .select({ visibility: agentShares.visibility })
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));

      if (share?.visibility !== 'link') return false;

      // Durable claim, written under the SAME lock/transaction as the
      // visibility check above — see this method's JSDoc.
      await tx.insert(agentShareRunReservations).values({
        agentId,
        id: operationId,
        topicId,
        visitorUserId,
      });

      return true;
    });

    if (!runnable) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }
  };

  /**
   * Atomically confirm a reservation is still live and, in the SAME
   * transaction, write the topic's `runningOperation` marker — the durable
   * counterpart to `assertRunnableForVisitor`'s reservation insert.
   *
   * Returns `false` (never writes the marker) if `revokeReservations`
   * already revoked this reservation. Correctness here rests on ordinary
   * Postgres row locking, not timing: this `DELETE ... WHERE revoked_at IS
   * NULL` and a concurrent `revokeReservations` `UPDATE` both target the
   * SAME row (`id = operationId`), so whichever commits first is the one the
   * other observes — there is no query-based polling window between them.
   * If this call wins the race, the marker write lands in the SAME
   * transaction as the reservation delete, so a revoke unblocked by this
   * transaction's commit is guaranteed to see the marker on its very next
   * (single, non-retried) `findActiveVisitorRunTopics` query.
   *
   * Callers MUST call `releaseReservation` on every path that does NOT reach
   * this method (e.g. `createOperation` throwing) — otherwise the row is
   * never cleaned up.
   */
  confirmReservation = async (params: {
    operationId: string;
    runningOperation: NonNullable<ChatTopicMetadata['runningOperation']>;
    topicId: string;
  }): Promise<boolean> => {
    const { operationId, runningOperation, topicId } = params;

    return this.db.transaction(async (tx) => {
      const [reservation] = await tx
        .delete(agentShareRunReservations)
        .where(
          and(
            eq(agentShareRunReservations.id, operationId),
            isNull(agentShareRunReservations.revokedAt),
          ),
        )
        .returning({ id: agentShareRunReservations.id });

      if (!reservation) return false;

      const [existingTopic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(eq(topics.id, topicId))
        .for('update');

      await tx
        .update(topics)
        .set({ metadata: { ...existingTopic?.metadata, runningOperation } })
        .where(eq(topics.id, topicId));

      return true;
    });
  };

  /**
   * Best-effort cleanup for a reservation that never reaches
   * `confirmReservation` — `createOperation` threw, or `confirmReservation`
   * itself returned `false` (already revoked). Unconditional delete (no
   * `revoked_at` filter): the caller already owns this operation id and is
   * done with it either way.
   */
  releaseReservation = async (operationId: string): Promise<void> => {
    await this.db
      .delete(agentShareRunReservations)
      .where(eq(agentShareRunReservations.id, operationId));
  };

  /**
   * Revoke every still-pending reservation for an agent — called right after
   * a revocation write (`deleteByAgentId` / `updateVisibility('private')` /
   * `writeAgentConfigWithShareReset`) commits.
   *
   * A single `UPDATE ... WHERE revoked_at IS NULL`, not a query loop: for any
   * reservation whose run is concurrently inside `confirmReservation`, this
   * statement blocks on that row until the confirm transaction commits or
   * rolls back (ordinary Postgres row locking — see `confirmReservation`'s
   * JSDoc), so by the time this call returns, every reservation it could
   * possibly race against has already been resolved one way or the other.
   * No fixed retry window, no missed operations.
   *
   * Returns the reservations this call itself revoked (i.e. runs that were
   * still standing up) so the caller can proactively interrupt them —
   * already-running operations (reservation already confirmed and deleted)
   * are covered separately by `TopicModel.findActiveVisitorRunTopics`, which
   * the SAME guarantee above makes safe to query just once, right after this
   * call returns.
   */
  revokeReservations = async (
    agentId: string,
  ): Promise<Array<{ operationId: string; topicId: string }>> => {
    const rows = await this.db
      .update(agentShareRunReservations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentShareRunReservations.agentId, agentId),
          isNull(agentShareRunReservations.revokedAt),
        ),
      )
      .returning({
        operationId: agentShareRunReservations.id,
        topicId: agentShareRunReservations.topicId,
      });

    return rows;
  };

  /**
   * Update share visibility for a personally owned agent.
   *
   * Publishing (`link`) re-validates `isHeterogeneousAgentConfig` here, AFTER
   * `withOwnedPersonalAgentLock` has taken the Agent row lock, using the
   * `model` / `agencyConfig` read as part of that same locked SELECT — not a
   * pre-lock read from the router. A pre-lock read (the previous approach:
   * `assertShareableAgent` in `apps/server/src/routers/lambda/agentShare.ts`
   * ran before this call) can observe a homogeneous config, then have
   * `AgentModel.updateConfig` land a heterogeneous change and reset the share
   * to `private` in between, and finally still flip it to `link` here — a
   * stale-validation lost update. Re-reading `model`/`agencyConfig` under the
   * lock closes that window: whichever of this call and `updateConfig` wins
   * the row lock decides the outcome, and the other sees its committed
   * result. See LOBE-11930.
   *
   * Only publishing (`link`) needs the check — reverting to `private` never
   * exposes visitor execution, so it must stay reachable even if the agent
   * config changed to a heterogeneous provider after the share was created.
   */
  updateVisibility = async (agentId: string, visibility: ShareVisibility) =>
    this.withOwnedPersonalAgentLock(agentId, async (tx, agent) => {
      if (visibility === 'link' && isHeterogeneousAgentConfig(agent)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
        });
      }

      const [updated] = await tx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return updated
        ? { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) }
        : null;
    });

  /** Disable sharing by deleting the agent's share record. */
  deleteByAgentId = async (agentId: string) =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [deleted] = await tx
        .delete(agentShares)
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return deleted ?? null;
    });

  /** Resolve the public metadata required by an agent share page. */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    if (!isUuid(shareId)) return null;

    const [share] = await db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentDescription: agents.description,
        agentId: agentShares.agentId,
        agentMarketIdentifier: agents.marketIdentifier,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentTitle: agents.title,
        ownerId: agents.userId,
        shareConfig: agentShares.shareConfig,
        shareId: agentShares.id,
        userViewCount: agentShares.userViewCount,
        visibility: agentShares.visibility,
      })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .where(
        and(eq(agentShares.id, shareId), isNull(agents.workspaceId), excludeReservedAgentSlug()),
      )
      .limit(1);

    if (!share) return null;

    return {
      ...share,
      agentAvatar: normalizeInboxAgentAvatar(share.agentAvatar, { slug: share.agentSlug }),
      agentTitle: normalizeInboxAgentTitle(share.agentTitle, { slug: share.agentSlug }),
      shareConfig: normalizeAgentShareConfig(share.shareConfig),
    };
  };

  /** Increment the successful page-view counter after access has been granted. */
  static incrementUserViewCount = async (db: LobeChatDatabase, shareId: string) => {
    await db
      .update(agentShares)
      .set({ userViewCount: sql`${agentShares.userViewCount} + 1` })
      .where(eq(agentShares.id, shareId));
  };

  /** Resolve a share and enforce private-share owner access. */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    accessUserId: string,
  ): Promise<AgentShareData> => {
    const share = await AgentShareModel.findByShareId(db, shareId);

    if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });

    const isOwner = accessUserId === share.ownerId;
    if (!isOwner && share.visibility === 'private') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    return share;
  };
}
