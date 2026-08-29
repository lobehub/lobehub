import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { isHeterogeneousAgentConfig } from '@lobechat/const';
import type { LobeAgentAgencyConfig, ShareVisibility } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, notInArray, or, sql } from 'drizzle-orm';

import type { AgentShareConfig, AgentShareConfigPatch, AgentShareItem } from '../schemas';
import { agents, agentShares } from '../schemas';
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
   * Take `FOR UPDATE` on the owned Agent row from an ALREADY-OPEN
   * transaction, without opening one of its own — the primitive
   * `withOwnedPersonalAgentLock` below builds on for instance mutations, and
   * that `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
   * (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`) call
   * directly, since those guards must hold this lock alongside their OWN
   * topic/message recount-and-insert work in a single transaction they
   * manage themselves.
   *
   * This is the SAME physical row every other share-mutation path locks
   * (`create`, `updateConfig`, `updateVisibility`, `deleteByAgentId`) — see
   * `withOwnedPersonalAgentLock`'s JSDoc for why one shared row is the
   * serialization point for this whole family, including the visitor abuse
   * guards.
   *
   * Returns `null` (never locks) when the agent does not exist, is not
   * personally owned by `ownerId`, is workspace-scoped, or is a reserved
   * builtin slug — callers must fail closed on `null`, mirroring every other
   * consumer of this same ownership predicate.
   */
  static lockOwnedAgentRow = async (
    tx: LobeChatDatabase,
    agentId: string,
    ownerId: string,
  ): Promise<LockedAgentSnapshot | null> => {
    const [agent] = await tx
      .select({ agencyConfig: agents.agencyConfig, id: agents.id, model: agents.model })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.userId, ownerId),
          isNull(agents.workspaceId),
          excludeReservedAgentSlug(),
        ),
      )
      .for('update');

    return (agent as LockedAgentSnapshot | undefined) ?? null;
  };

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
   * `AiAgentService`.
   *
   * This is also the ONLY lock in the whole share-mutation family — no
   * advisory lock runs alongside it anywhere. The visitor abuse guards used
   * to take a separate `pg_advisory_xact_lock` keyed per
   * `agentId:visitorUserId` (topic cap) or per `topicId` (turn cap) to
   * serialize concurrent visitor requests against EACH OTHER, but that lock
   * was disjoint from this one: it never conflicted with a concurrent
   * `updateConfig`/`updateVisibility`/`deleteByAgentId` write, so a cap read
   * inside the advisory lock could still straddle a concurrent cap
   * reduction — read the OLD value, then have the owner's `updateConfig`
   * commit a lower one, then insert against the stale number anyway. Reusing
   * THIS row lock in the guards (via `lockOwnedAgentRow` above) closes that
   * gap for free: a cap read can no longer be concurrent with a config write
   * on the same agent, because both now contend for the same row. The
   * guards' own recount-then-insert was already what the advisory lock
   * existed to serialize (concurrent visitor requests to each other), and the
   * row lock provides that too — just at agent granularity rather than
   * per-visitor/per-topic. Keeping a second, finer-grained lock alongside
   * this one would only have protected visitor-vs-visitor concurrency, which
   * this row lock already covers; it would not have added any additional
   * safety against the config-reduction race the second lock exists for, so
   * dropping it is not a shortcut — it removes a lock that had stopped
   * earning its place. See `shareVisitorAbuseGuards.ts` for the full
   * before/after and the deadlock analysis for stacking this lock into an
   * already-open transaction.
   */
  private withOwnedPersonalAgentLock = async <T>(
    agentId: string,
    mutation: (tx: LobeChatDatabase, agent: LockedAgentSnapshot) => Promise<T>,
  ): Promise<T | null> =>
    this.db.transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      const agent = await AgentShareModel.lockOwnedAgentRow(tx, agentId, this.userId);

      if (!agent) return null;
      return mutation(tx, agent);
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
   * Read the CURRENT `maxTopicsPerVisitor` / `maxTurnsPerTopic` caps for an
   * agent's share, bypassing any snapshot the caller might already be
   * holding.
   *
   * WHY this must be a fresh read and not a value threaded through from
   * earlier in the request: `reserveShareVisitorTopicOrThrow` /
   * `reserveShareVisitorTurnOrThrow`
   * (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`) take
   * `AgentShareModel.lockOwnedAgentRow`'s `agents.id FOR UPDATE` lock and
   * recount existing topics/messages immediately before the real INSERT —
   * but `shareChat.ts`'s `execAgent` resolves the share (and therefore these
   * caps) exactly ONCE, at `findByShareIdWithAccessCheck`, long before that
   * lock is taken. `AiAgentService.execAgentWithReservation` does thousands
   * of lines of agent-config/tool/knowledge-base resolution in between (real
   * I/O, not instant). A caller that passed the SNAPSHOTTED cap into those
   * guard functions would let an owner's cap REDUCTION lose to every request
   * already past that initial read: the locked recount would only ever
   * enforce whatever number it was TOLD, not the number the owner currently
   * has configured — during an active flood, lowering 50 topics to 1 would
   * still let every already-in-flight request reach 50. Calling this method
   * from INSIDE the SAME locked transaction those guard functions hold closes
   * that gap: the recount always compares against the cap as of RIGHT NOW,
   * not as of request entry. Locking the Agent row (rather than a separate
   * advisory lock keyed per visitor/topic) additionally guarantees this read
   * can never straddle a CONCURRENT `updateConfig` write either: both now
   * contend for the same row, so whichever transaction commits first is the
   * one this read is guaranteed to observe — see `lockOwnedAgentRow`'s and
   * `withOwnedPersonalAgentLock`'s JSDoc for the full before/after.
   *
   * Falls back to `normalizeAgentShareConfig`'s defaults exactly like every
   * other reader of `agentShares.shareConfig`, so a legacy row missing these
   * keys still enforces the same baseline (5 topics / 20 turns) instead of
   * `undefined >= count` silently passing.
   *
   * `shareId` is returned alongside the caps for the identical staleness
   * reason documented above: `shareChat.ts` resolves `share.shareId` exactly
   * ONCE, at `findByShareIdWithAccessCheck`, long before
   * `reserveShareVisitorTopicOrThrow` reaches this same locked transaction.
   * A caller-supplied `shareId` could be a share instance the owner already
   * disabled and replaced (`create()` mints a new UUID every disable →
   * re-enable cycle) by the time the topic is actually inserted — stamping
   * the STALE id would misfile the new topic under a share instance that no
   * longer exists, while stamping nothing would leave it unscoped forever.
   * Reading it fresh here, under the same `agents.id FOR UPDATE` lock as the
   * caps, guarantees the topic is always stamped with whichever share
   * instance is ACTUALLY live at insert time. `null` when the agent has no
   * share row at all (fully disabled, never re-enabled) — callers must fail
   * closed on that, mirroring `lockOwnedAgentRow`'s `null` contract. See
   * `topics.shareId`'s JSDoc (`../schemas/topic.ts`).
   */
  static readCurrentVisitorCaps = async (
    db: LobeChatDatabase,
    agentId: string,
  ): Promise<
    Pick<AgentShareConfig, 'maxTopicsPerVisitor' | 'maxTurnsPerTopic'> & { shareId: string | null }
  > => {
    const [row] = await db
      .select({ id: agentShares.id, shareConfig: agentShares.shareConfig })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));

    const normalized = normalizeAgentShareConfig(row?.shareConfig ?? null);
    return {
      maxTopicsPerVisitor: normalized.maxTopicsPerVisitor,
      maxTurnsPerTopic: normalized.maxTurnsPerTopic,
      shareId: row?.id ?? null,
    };
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
   * result.
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
  deleteByAgentId = async (agentId: string): Promise<AgentShareItem | null> =>
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
