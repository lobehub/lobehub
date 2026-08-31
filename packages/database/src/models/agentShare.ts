import {
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  AGENT_SHARE_SLUG_PATTERN,
  RESERVED_AGENT_SHARE_SLUGS,
} from '@lobechat/const';
import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, ne, sql } from 'drizzle-orm';

import type { AgentShareConfig, AgentShareConfigPatch, AgentShareItem } from '../schemas';
import { agents, agentShares } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { isUuid } from '../utils/uuid';

const DEFAULT_AGENT_SHARE_CONFIG = {
  allowCreatorViewSessions: false,
  allowReadMemory: false,
  enabledToolIds: [],
  maxTopicsPerVisitor: AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  maxTurnsPerTopic: AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  showErrorDetails: false,
  showModelInfo: false,
} satisfies AgentShareConfig;

/** Fill fields missing from rows created before a field was introduced, or never explicitly set. */
const normalizeAgentShareConfig = (config: AgentShareConfig | null): AgentShareConfig => ({
  allowCreatorViewSessions:
    config?.allowCreatorViewSessions ?? DEFAULT_AGENT_SHARE_CONFIG.allowCreatorViewSessions,
  allowReadMemory: config?.allowReadMemory ?? DEFAULT_AGENT_SHARE_CONFIG.allowReadMemory,
  enabledToolIds: config?.enabledToolIds ?? DEFAULT_AGENT_SHARE_CONFIG.enabledToolIds,
  maxTopicsPerVisitor:
    config?.maxTopicsPerVisitor ?? DEFAULT_AGENT_SHARE_CONFIG.maxTopicsPerVisitor,
  maxTurnsPerTopic: config?.maxTurnsPerTopic ?? DEFAULT_AGENT_SHARE_CONFIG.maxTurnsPerTopic,
  // Unlike the boolean/list fields above, an unset spend cap means
  // "unlimited" (enforced by the Cloud billing gate), not "0" — leave it
  // `undefined` rather than defaulting it to a number.
  monthlySpendLimit: config?.monthlySpendLimit,
  showErrorDetails: config?.showErrorDetails ?? DEFAULT_AGENT_SHARE_CONFIG.showErrorDetails,
  showModelInfo: config?.showModelInfo ?? DEFAULT_AGENT_SHARE_CONFIG.showModelInfo,
  slug: config?.slug,
});

/** An `agentShares` row with `shareConfig` filled via `normalizeAgentShareConfig`. */
type NormalizedAgentShareItem = Omit<AgentShareItem, 'shareConfig'> & {
  shareConfig: AgentShareConfig;
};

export type AgentShareData = NonNullable<
  Awaited<ReturnType<(typeof AgentShareModel)['findByShareId']>>
>;

/** Minimal locked-row snapshot returned by {@link AgentShareModel.lockOwnedAgentRow}. */
interface LockedAgentSnapshot {
  id: string;
}

export class AgentShareModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Agent sharing is personal-only; workspace agents fail this predicate. */
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
          ),
        ),
    );

  /**
   * Take `FOR UPDATE` on the owned Agent row from an ALREADY-OPEN
   * transaction, without opening one of its own. Every instance mutation
   * below (`create`, `updateConfig`, `updateVisibility`, `deleteByAgentId`,
   * `updateSlug`) serializes on this same physical row, so two concurrent
   * writes on the same agent's share can never interleave.
   *
   * Returns `null` (never locks) when the agent does not exist, is not
   * personally owned by `ownerId`, or is workspace-scoped — callers must fail
   * closed on `null`.
   */
  static lockOwnedAgentRow = async (
    tx: LobeChatDatabase,
    agentId: string,
    ownerId: string,
  ): Promise<LockedAgentSnapshot | null> => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, ownerId), isNull(agents.workspaceId)))
      .for('update');

    return agent ?? null;
  };

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
      // `id` mints a fresh UUID on every insert — disabling (`deleteByAgentId`)
      // and re-enabling a share therefore always yields a NEW id, so any link
      // previously handed out no longer resolves. This is a deliberate
      // revocation property, not an incidental side effect of the schema.
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
      return existing ?? null;
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
  getByAgentId = async (agentId: string): Promise<NormalizedAgentShareItem | null> => {
    const [share] = await this.db
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, agentId), this.ownership()))
      .limit(1);

    if (!share) return null;

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /**
   * Atomically merge client-owned fields into the existing config, preserving
   * sibling keys that were not part of this patch. A flat top-level jsonb
   * merge is enough here — unlike the old branch's `filePermissionConfig`,
   * every field on the current `AgentShareConfig` is a top-level scalar/array,
   * so there is no nested object that needs its own merge branch.
   */
  updateConfig = async (
    agentId: string,
    config: AgentShareConfigPatch,
  ): Promise<NormalizedAgentShareItem | null> =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [updated] = await tx
        .update(agentShares)
        .set({
          shareConfig: sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify(config)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      if (!updated) return null;

      return { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };
    });

  /** Update share visibility for a personally owned agent. */
  updateVisibility = async (
    agentId: string,
    visibility: ShareVisibility,
  ): Promise<NormalizedAgentShareItem | null> =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [updated] = await tx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      if (!updated) return null;

      return { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };
    });

  /**
   * Validate and persist a custom URL slug for this share.
   *
   * Uniqueness is checked application-side (`share_config->>'slug'` has no DB
   * index/constraint — see the field's JSDoc in the schema). The `agents.id
   * FOR UPDATE` lock only serializes writes on the SAME agent; two agents
   * racing for the same slug hold different row locks and would both pass a
   * plain conflict-check SELECT (neither sees the other's uncommitted write),
   * so the check is additionally serialized on a transaction-scoped advisory
   * lock keyed by the slug itself.
   */
  updateSlug = async (agentId: string, slug: string): Promise<NormalizedAgentShareItem | null> => {
    if (!AGENT_SHARE_SLUG_PATTERN.test(slug)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_SHARE_SLUG' });
    }

    if (RESERVED_AGENT_SHARE_SLUGS.includes(slug)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'RESERVED_SHARE_SLUG' });
    }

    return this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      // Cross-agent uniqueness barrier: released automatically at commit/rollback.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`agent_share_slug:${slug}`}))`);

      const [conflict] = await tx
        .select({ id: agentShares.id })
        .from(agentShares)
        .where(
          and(
            sql`${agentShares.shareConfig} ->> 'slug' = ${slug}`,
            ne(agentShares.agentId, agentId),
          ),
        )
        .limit(1);

      if (conflict) {
        throw new TRPCError({ code: 'CONFLICT', message: 'SHARE_SLUG_TAKEN' });
      }

      const [updated] = await tx
        .update(agentShares)
        .set({
          shareConfig: sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify({ slug })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      if (!updated) return null;

      return { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };
    });
  };

  /** Disable sharing by deleting the agent's share record. */
  deleteByAgentId = async (agentId: string): Promise<AgentShareItem | null> =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [deleted] = await tx
        .delete(agentShares)
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return deleted ?? null;
    });

  /**
   * Read the CURRENT `maxTopicsPerVisitor` / `maxTurnsPerTopic` caps for an
   * agent's share, bypassing any snapshot a caller might already be holding —
   * intended to be called from inside the SAME locked transaction a
   * visitor-abuse guard uses to recount and insert, so a cap reduction the
   * owner just made is always the number actually enforced, not a stale value
   * read earlier in the request. `shareId` is returned alongside for the same
   * staleness reason: it identifies which live share instance a newly created
   * visitor topic should be scoped to.
   *
   * Falls back to `normalizeAgentShareConfig`'s defaults exactly like every
   * other reader of `agentShares.shareConfig`.
   */
  static readCurrentVisitorCaps = async (
    db: LobeChatDatabase,
    agentId: string,
  ): Promise<
    Required<Pick<AgentShareConfig, 'maxTopicsPerVisitor' | 'maxTurnsPerTopic'>> & {
      shareId: string | null;
    }
  > => {
    const [row] = await db
      .select({ id: agentShares.id, shareConfig: agentShares.shareConfig })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));

    const normalized = normalizeAgentShareConfig(row?.shareConfig ?? null);
    return {
      maxTopicsPerVisitor: normalized.maxTopicsPerVisitor!,
      maxTurnsPerTopic: normalized.maxTurnsPerTopic!,
      shareId: row?.id ?? null,
    };
  };

  /**
   * Resolve the public metadata required by an agent share page. Workspace
   * agents never resolve here — `agentShares` rows only exist for personal
   * agents (see `create`'s ownership check), but the `isNull` guard is kept
   * as defense in depth against a row surviving some future write path that
   * does not go through this model.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    if (!isUuid(shareId)) return null;

    const [share] = await db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentDescription: agents.description,
        agentId: agentShares.agentId,
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
      .where(and(eq(agentShares.id, shareId), isNull(agents.workspaceId)))
      .limit(1);

    if (!share) return null;

    return {
      ...share,
      agentAvatar: normalizeInboxAgentAvatar(share.agentAvatar, { slug: share.agentSlug }),
      agentTitle: normalizeInboxAgentTitle(share.agentTitle, { slug: share.agentSlug }),
      shareConfig: normalizeAgentShareConfig(share.shareConfig),
    };
  };

  /**
   * Resolve a share by its custom `slug` (application-level lookup into
   * `share_config->>'slug'`, no DB index) or, failing that pattern, by its
   * `id` when the input looks like a UUID. Returns a share of ANY visibility
   * — callers must run their own access check (see
   * `findByShareIdWithAccessCheck`) before exposing the result.
   */
  static findBySlugOrId = async (db: LobeChatDatabase, slugOrId: string) => {
    if (isUuid(slugOrId)) {
      return AgentShareModel.findByShareId(db, slugOrId);
    }

    const [share] = await db
      .select({ id: agentShares.id })
      .from(agentShares)
      .where(sql`${agentShares.shareConfig} ->> 'slug' = ${slugOrId}`)
      .limit(1);

    if (!share) return null;

    return AgentShareModel.findByShareId(db, share.id);
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
    viewerId: string,
  ): Promise<AgentShareData> => {
    const share = await AgentShareModel.findByShareId(db, shareId);

    if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });

    const isOwner = viewerId === share.ownerId;
    if (!isOwner && share.visibility === 'private') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    return share;
  };
}
