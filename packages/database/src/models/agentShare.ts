import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  AGENT_SHARE_DEFAULT_MONTHLY_SPEND_LIMIT,
  AGENT_SHARE_SLUG_PATTERN,
  RESERVED_AGENT_SHARE_SLUGS,
} from '@lobechat/const';
import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, ne, sql } from 'drizzle-orm';

import type {
  AgentShareConfig,
  AgentShareConfigPatch,
  AgentShareItem,
  NormalizedAgentShareConfig,
} from '../schemas';
import { agents, agentShares, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { isUuid } from '../utils/uuid';

const DEFAULT_AGENT_SHARE_CONFIG = {
  allowCreatorViewSessions: false,
  allowReadMemory: false,
  maxFileStorage: AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  maxTopicsPerVisitor: AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  maxTurnsPerTopic: AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  monthlySpendLimit: AGENT_SHARE_DEFAULT_MONTHLY_SPEND_LIMIT,
  showErrorDetails: false,
  showModelInfo: false,
  toolGrants: [],
} satisfies AgentShareConfig;

/** Fill fields missing from rows created before a field was introduced, or never explicitly set. */
const normalizeAgentShareConfig = (
  config: AgentShareConfig | null,
): NormalizedAgentShareConfig => ({
  allowCreatorViewSessions:
    config?.allowCreatorViewSessions ?? DEFAULT_AGENT_SHARE_CONFIG.allowCreatorViewSessions,
  allowReadMemory: config?.allowReadMemory ?? DEFAULT_AGENT_SHARE_CONFIG.allowReadMemory,
  maxFileStorage: config?.maxFileStorage ?? DEFAULT_AGENT_SHARE_CONFIG.maxFileStorage,
  maxTopicsPerVisitor:
    config?.maxTopicsPerVisitor ?? DEFAULT_AGENT_SHARE_CONFIG.maxTopicsPerVisitor,
  maxTurnsPerTopic: config?.maxTurnsPerTopic ?? DEFAULT_AGENT_SHARE_CONFIG.maxTurnsPerTopic,
  monthlySpendLimit: config?.monthlySpendLimit ?? DEFAULT_AGENT_SHARE_CONFIG.monthlySpendLimit,
  showErrorDetails: config?.showErrorDetails ?? DEFAULT_AGENT_SHARE_CONFIG.showErrorDetails,
  showModelInfo: config?.showModelInfo ?? DEFAULT_AGENT_SHARE_CONFIG.showModelInfo,
  slug: config?.slug,
  toolGrants: config?.toolGrants ?? DEFAULT_AGENT_SHARE_CONFIG.toolGrants,
});

/** An `agentShares` row with `shareConfig` filled via `normalizeAgentShareConfig`. */
type NormalizedAgentShareItem = Omit<AgentShareItem, 'shareConfig'> & {
  shareConfig: NormalizedAgentShareConfig;
};

export type AgentShareData = NonNullable<
  Awaited<ReturnType<(typeof AgentShareModel)['findByShareId']>>
>;

/** Minimal locked-row snapshot returned by {@link AgentShareModel.lockScopedAgentRow}. */
interface LockedAgentSnapshot {
  id: string;
  /** The agent's own profile slug (`agents.slug`), unique per owner only. */
  slug: string | null;
  workspaceId: string | null;
}

interface AgentShareModelOptions {
  /** Re-check Workspace share authority after the Agent row lock is acquired. */
  authorizeMutation?: (tx: LobeChatDatabase, agentId: string) => Promise<void>;
}

/**
 * Static share-slug rules shared by the owner-facing `updateSlug` and the
 * best-effort seed in `create`. A UUID-shaped slug would be unreachable:
 * `findBySlugOrId` resolves UUID-shaped input as a share id before ever trying
 * the slug lookup. Returns `null` when the slug passes.
 */
const getShareSlugRejection = (
  slug: string,
): 'INVALID_SHARE_SLUG' | 'RESERVED_SHARE_SLUG' | null => {
  if (!AGENT_SHARE_SLUG_PATTERN.test(slug) || isUuid(slug)) return 'INVALID_SHARE_SLUG';
  if (RESERVED_AGENT_SHARE_SLUGS.includes(slug)) return 'RESERVED_SHARE_SLUG';
  return null;
};

export class AgentShareModel {
  private authorizeMutation?: AgentShareModelOptions['authorizeMutation'];
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    options: AgentShareModelOptions = {},
  ) {
    this.authorizeMutation = options.authorizeMutation;
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Scope a share to the Agent's current tenancy. In personal mode the caller
   * must still own the Agent; Workspace authorization is enforced by the
   * resource-permission service before this model is called.
   */
  private scope = () =>
    exists(
      this.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          this.workspaceId
            ? and(
                eq(agents.id, agentShares.agentId),
                eq(agents.workspaceId, this.workspaceId),
                eq(agentShares.workspaceId, this.workspaceId),
              )
            : and(
                eq(agents.id, agentShares.agentId),
                eq(agents.userId, this.userId),
                isNull(agents.workspaceId),
                isNull(agentShares.workspaceId),
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
   * Returns `null` (never locks) when the agent does not exist in the requested
   * scope. Personal scope additionally requires ownership. Workspace callers
   * are checked once by the router and again through `authorizeMutation` after
   * this lock, closing the owner-handover race between authorization and write.
   */
  static lockScopedAgentRow = async (
    tx: LobeChatDatabase,
    agentId: string,
    params: { userId: string; workspaceId?: string },
  ): Promise<LockedAgentSnapshot | null> => {
    const [agent] = await tx
      .select({ id: agents.id, slug: agents.slug, workspaceId: agents.workspaceId })
      .from(agents)
      .where(
        params.workspaceId
          ? and(eq(agents.id, agentId), eq(agents.workspaceId, params.workspaceId))
          : and(
              eq(agents.id, agentId),
              eq(agents.userId, params.userId),
              isNull(agents.workspaceId),
            ),
      )
      .for('update');

    return agent ?? null;
  };

  /**
   * Cross-agent slug uniqueness barrier, to be called from an already-open
   * transaction. `shareConfig.slug` has no unique index (see the schema
   * JSDoc), and the `agents.id FOR UPDATE` lock only serializes writes on the
   * SAME agent: two agents racing for one slug hold different row locks and
   * would both pass a plain conflict SELECT (neither sees the other's
   * uncommitted write). The check is therefore additionally serialized on a
   * transaction-scoped advisory lock keyed by the slug itself, released
   * automatically at commit/rollback.
   */
  private static isShareSlugTaken = async (
    tx: LobeChatDatabase,
    slug: string,
    agentId: string,
  ): Promise<boolean> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`agent_share_slug:${slug}`}))`);

    const [conflict] = await tx
      .select({ id: agentShares.id })
      .from(agentShares)
      .where(
        and(sql`${agentShares.shareConfig} ->> 'slug' = ${slug}`, ne(agentShares.agentId, agentId)),
      )
      .limit(1);

    return !!conflict;
  };

  /**
   * Best-effort default for a brand-new share: the visitor url starts out as
   * `/a/<the agent's own profile slug>` instead of a bare UUID. Agent
   * slugs are unique per OWNER while share slugs are global, so a slug another
   * share already holds — or one the share rules reject — simply leaves the
   * seed unset; the owner can still pick any slug in the settings. Never
   * throws: a seed failure must not fail the share creation itself.
   */
  private static seedSlugFromAgent = async (
    tx: LobeChatDatabase,
    share: AgentShareItem,
    agentSlug: string | null,
  ): Promise<AgentShareItem> => {
    const slug = agentSlug?.trim().toLowerCase();
    if (!slug || getShareSlugRejection(slug)) return share;
    if (await AgentShareModel.isShareSlugTaken(tx, slug, share.agentId)) return share;

    const [updated] = await tx
      .update(agentShares)
      .set({
        shareConfig: sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify({ slug })}::jsonb`,
      })
      .where(eq(agentShares.id, share.id))
      .returning();

    return updated ?? share;
  };

  private withScopedAgentLock = async <T>(
    agentId: string,
    mutation: (tx: LobeChatDatabase, agent: LockedAgentSnapshot) => Promise<T>,
  ): Promise<T | null> =>
    this.db.transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      const agent = await AgentShareModel.lockScopedAgentRow(tx, agentId, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });

      if (!agent) return null;
      await this.authorizeMutation?.(tx, agentId);
      return mutation(tx, agent);
    });

  private static shareScope = (agent: LockedAgentSnapshot) =>
    agent.workspaceId
      ? eq(agentShares.workspaceId, agent.workspaceId)
      : isNull(agentShares.workspaceId);

  /** Create a private share by default, or return the existing share for the agent. */
  create = async (agentId: string, visibility: ShareVisibility = 'private') => {
    const share = await this.withScopedAgentLock(agentId, async (tx, agent) => {
      // One row per agent, forever: `onConflictDoNothing` on `agentId` makes a
      // re-enable fall back to the SELECT below, returning the existing row
      // untouched. That is what keeps a share's id and custom slug — i.e. the
      // link already handed out — stable across a disable → re-enable cycle,
      // since disabling only flips `visibility` to `private`.
      const [created] = await tx
        .insert(agentShares)
        .values({
          agentId,
          shareConfig: DEFAULT_AGENT_SHARE_CONFIG,
          visibility,
          workspaceId: agent.workspaceId,
        })
        .onConflictDoNothing({ target: agentShares.agentId })
        .returning();

      // Only a freshly minted row gets the profile-slug default; an existing
      // row keeps whatever slug (or none) its owner already chose.
      if (created) return AgentShareModel.seedSlugFromAgent(tx, created, agent.slug);

      const [existing] = await tx
        .select()
        .from(agentShares)
        .where(
          and(
            eq(agentShares.agentId, agentId),
            agent.workspaceId
              ? eq(agentShares.workspaceId, agent.workspaceId)
              : isNull(agentShares.workspaceId),
          ),
        )
        .limit(1);
      return existing ?? null;
    });

    if (!share) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Agent sharing is not available in this scope',
      });
    }

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /** Get a share by agent ID for its owner. */
  getByAgentId = async (agentId: string): Promise<NormalizedAgentShareItem | null> => {
    const [share] = await this.db
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, agentId), this.scope()))
      .limit(1);

    if (!share) return null;

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /**
   * Minimal Workspace-wide share inventory for administrators. Deliberately
   * excludes `shareConfig` and Agent profile fields: an administrator may
   * audit and stop external exposure without gaining read access to a private
   * Agent's instructions, tools, credentials, or visitor conversations.
   */
  static listWorkspaceSharesForAudit = async (
    db: LobeChatDatabase,
    workspaceId: string,
    options: { limit: number; offset: number },
  ) =>
    db
      .select({
        agentId: agentShares.agentId,
        agentVisibility: agents.visibility,
        createdAt: agentShares.createdAt,
        ownerId: agents.userId,
        shareId: agentShares.id,
        shareVisibility: agentShares.visibility,
        updatedAt: agentShares.updatedAt,
        userViewCount: agentShares.userViewCount,
      })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .where(and(eq(agentShares.workspaceId, workspaceId), eq(agents.workspaceId, workspaceId)))
      .orderBy(sql`${agentShares.updatedAt} DESC, ${agentShares.id} DESC`)
      .limit(options.limit)
      .offset(options.offset);

  /**
   * Administrative emergency stop for one Workspace share. This is a pause,
   * not an irreversible revoke: it keeps the row and URL so the Agent owner
   * may inspect the state and explicitly republish later.
   */
  static forceDisableWorkspaceShare = async (
    db: LobeChatDatabase,
    workspaceId: string,
    shareId: string,
  ) =>
    db.transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      const [share] = await tx
        .select({ agentId: agentShares.agentId })
        .from(agentShares)
        .where(and(eq(agentShares.id, shareId), eq(agentShares.workspaceId, workspaceId)))
        .limit(1);
      if (!share) return null;

      // Serialize against owner-side enable/disable/config mutations, all of
      // which lock this same Agent row before touching the share.
      const agent = await AgentShareModel.lockScopedAgentRow(tx, share.agentId, {
        userId: '',
        workspaceId,
      });
      if (!agent) return null;

      const [updated] = await tx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility: 'private' })
        .where(and(eq(agentShares.id, shareId), eq(agentShares.workspaceId, workspaceId)))
        .returning({
          agentId: agentShares.agentId,
          shareId: agentShares.id,
          visibility: agentShares.visibility,
        });

      return updated ?? null;
    });

  /**
   * Atomically merge client-owned fields into the existing config, preserving
   * sibling keys that were not part of this patch. A flat top-level jsonb
   * merge is enough here — unlike the old branch's `filePermissionConfig`,
   * every field on the current `AgentShareConfig` is a top-level scalar/array,
   * so there is no nested object that needs its own merge branch.
   *
   * `slug` is stripped even if smuggled past the type — it has its own
   * validated write path (`updateSlug`).
   */
  updateConfig = async (
    agentId: string,
    config: AgentShareConfigPatch,
  ): Promise<NormalizedAgentShareItem | null> =>
    this.withScopedAgentLock(agentId, async (tx, agent) => {
      const { slug: _slug, ...patch } = config as AgentShareConfigPatch & { slug?: unknown };
      const setEntries = Object.entries(patch).filter(([, v]) => v !== undefined);

      let configExpr = sql`COALESCE(${agentShares.shareConfig}, '{}'::jsonb)`;
      if (setEntries.length > 0) {
        configExpr = sql`${configExpr} || ${JSON.stringify(Object.fromEntries(setEntries))}::jsonb`;
      }

      const [updated] = await tx
        .update(agentShares)
        .set({
          shareConfig: sql<AgentShareConfig>`${configExpr}`,
          updatedAt: new Date(),
        })
        .where(and(eq(agentShares.agentId, agentId), AgentShareModel.shareScope(agent)))
        .returning();

      if (!updated) return null;

      return { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };
    });

  /**
   * Update share visibility for an Agent in the model's owning scope. This is also the
   * "turn sharing off" path (`private`): the row, its id and its custom slug
   * are all preserved, so flipping back to `link` republishes the exact same
   * URL the owner already handed out.
   */
  updateVisibility = async (
    agentId: string,
    visibility: ShareVisibility,
  ): Promise<NormalizedAgentShareItem | null> =>
    this.withScopedAgentLock(agentId, async (tx, agent) => {
      const [updated] = await tx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility })
        .where(and(eq(agentShares.agentId, agentId), AgentShareModel.shareScope(agent)))
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
   *
   * `slug: null` clears the custom slug (removes the jsonb key) — the share
   * then resolves only by its raw id again.
   */
  updateSlug = async (
    agentId: string,
    slug: string | null,
  ): Promise<NormalizedAgentShareItem | null> => {
    if (slug === null) {
      return this.withScopedAgentLock(agentId, async (tx, agent) => {
        const [updated] = await tx
          .update(agentShares)
          .set({
            shareConfig: sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) - 'slug'`,
            updatedAt: new Date(),
          })
          .where(and(eq(agentShares.agentId, agentId), AgentShareModel.shareScope(agent)))
          .returning();

        if (!updated) return null;

        return { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };
      });
    }

    const rejection = getShareSlugRejection(slug);
    if (rejection) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: rejection });
    }

    return this.withScopedAgentLock(agentId, async (tx, agent) => {
      if (await AgentShareModel.isShareSlugTaken(tx, slug, agentId)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'SHARE_SLUG_TAKEN' });
      }

      const [updated] = await tx
        .update(agentShares)
        .set({
          shareConfig: sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify({ slug })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(and(eq(agentShares.agentId, agentId), AgentShareModel.shareScope(agent)))
        .returning();

      if (!updated) return null;

      return { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };
    });
  };

  /**
   * Hard-delete the agent's share record, dropping its id and custom slug for
   * good.
   *
   * NOT the "turn sharing off" path — that is `updateVisibility(agentId,
   * 'private')`, which keeps the link resumable. No product flow calls this
   * today; it stays as the model-level primitive for a genuine, irreversible
   * teardown (and lets tests build the "share row replaced" scenario that
   * `isRunStillAuthorized` guards against).
   */
  deleteByAgentId = async (agentId: string): Promise<AgentShareItem | null> =>
    this.withScopedAgentLock(agentId, async (tx, agent) => {
      const [deleted] = await tx
        .delete(agentShares)
        .where(and(eq(agentShares.agentId, agentId), AgentShareModel.shareScope(agent)))
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
    Required<
      Pick<AgentShareConfig, 'maxTopicsPerVisitor' | 'maxTurnsPerTopic' | 'monthlySpendLimit'>
    > & {
      shareId: string | null;
      workspaceId: string | null;
    }
  > => {
    const [row] = await db
      .select({
        id: agentShares.id,
        shareConfig: agentShares.shareConfig,
        workspaceId: agentShares.workspaceId,
      })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .where(
        and(
          eq(agentShares.agentId, agentId),
          sql`${agentShares.workspaceId} IS NOT DISTINCT FROM ${agents.workspaceId}`,
        ),
      );

    const normalized = normalizeAgentShareConfig(row?.shareConfig ?? null);
    return {
      maxTopicsPerVisitor: normalized.maxTopicsPerVisitor!,
      maxTurnsPerTopic: normalized.maxTurnsPerTopic!,
      monthlySpendLimit: normalized.monthlySpendLimit!,
      shareId: row?.id ?? null,
      workspaceId: row?.workspaceId ?? null,
    };
  };

  /**
   * Serialize the per-share upload cap decision, to be called from inside the
   * reservation transaction BEFORE the usage is counted. The cap is a sum over
   * two tables (settled visitor files + live reservations) that no row lock
   * covers, and the only lock the reservation itself takes — the creator's
   * users row, inside the deployment's quota check — comes AFTER the caller's
   * admission hook. Without this barrier two concurrent visitors both read the
   * pre-insert sum and both slip under the cap. Transaction-scoped advisory
   * lock keyed by share id (same pattern as the slug barrier), released
   * automatically at commit/rollback.
   */
  static lockUploadAdmission = async (tx: LobeChatDatabase, shareId: string): Promise<void> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`agent_share_upload:${shareId}`}))`,
    );
  };

  /**
   * Whether an in-flight visitor run is STILL authorized to continue: the
   * agent's share row must exist, still be the SAME instance the run was
   * authorized against (`shareId`), and still be `link`.
   *
   * Turning sharing off flips `visibility` to `private` and KEEPS the row, so
   * a disable → re-enable cycle deliberately resumes the same link and must
   * not invalidate anything: the visibility check alone covers the pause. The
   * id comparison still guards the cases where the row genuinely goes away and
   * comes back as a different instance — a hard delete (`deleteByAgentId`) or
   * the agent being deleted and recreated under the same id.
   *
   * The share and Agent must also remain in the same tenancy. Moving an Agent
   * between personal and Workspace scope, or between Workspaces, hard-deletes
   * the old share; the join is defense in depth if a partial/manual write ever
   * leaves a mismatched row behind. A same-Workspace owner handover keeps a
   * public link live and pauses a private one until its new owner republishes.
   *
   * Deliberately cheap (one indexed lookup + a primary-key join): it runs once
   * per runtime step. Returns `false` — never throws — for an ordinary
   * "no longer authorized" outcome; a THROWN error must be treated as
   * unauthorized too by the caller (fail closed, never fail open).
   */
  static isRunStillAuthorized = async (
    db: LobeChatDatabase,
    params: { agentId: string; shareId: string },
  ): Promise<boolean> => {
    const [share] = await db
      .select({ id: agentShares.id, visibility: agentShares.visibility })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .where(
        and(
          eq(agentShares.agentId, params.agentId),
          sql`${agentShares.workspaceId} IS NOT DISTINCT FROM ${agents.workspaceId}`,
        ),
      )
      .limit(1);

    return !!share && share.id === params.shareId && share.visibility === 'link';
  };

  /**
   * Resolve the public metadata required by an agent share page. The
   * null-safe tenancy equality is load-bearing: both personal and Workspace
   * Agents may be shared, but a row that no longer matches its Agent's current
   * scope must never resolve.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    if (!isUuid(shareId)) return null;

    const [share] = await db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentDescription: agents.description,
        agentId: agentShares.agentId,
        // Model identity is for a server-side capability lookup only (what
        // media a visitor may attach); the visitor payload never carries it.
        agentModel: agents.model,
        agentName: agents.name,
        agentOpeningQuestions: agents.openingQuestions,
        agentProvider: agents.provider,
        agentSlug: agents.slug,
        agentTags: agents.tags,
        agentTitle: agents.title,
        // Creator identity for the visitor-facing profile. Left-joined on the
        // owner rather than read through a second query: the share page needs
        // it on its only round trip, and the row is already joined for the
        // tenancy-consistency guard below.
        ownerAvatar: users.avatar,
        ownerFullName: users.fullName,
        ownerId: agents.userId,
        ownerUsername: users.username,
        shareConfig: agentShares.shareConfig,
        shareId: agentShares.id,
        userViewCount: agentShares.userViewCount,
        visibility: agentShares.visibility,
        workspaceId: agentShares.workspaceId,
      })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .leftJoin(users, eq(agents.userId, users.id))
      .where(
        and(
          eq(agentShares.id, shareId),
          sql`${agentShares.workspaceId} IS NOT DISTINCT FROM ${agents.workspaceId}`,
        ),
      )
      .limit(1);

    if (!share) return null;

    return {
      ...share,
      agentAvatar: normalizeInboxAgentAvatar(share.agentAvatar, { slug: share.agentSlug }),
      agentOpeningQuestions: share.agentOpeningQuestions ?? [],
      agentTags: share.agentTags ?? [],
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

    // Stored slugs are always lowercase (enforced in `updateSlug`), so
    // lowercase the input to keep share URLs case-insensitive.
    const slug = slugOrId.toLowerCase();

    const [share] = await db
      .select({ id: agentShares.id })
      .from(agentShares)
      .where(sql`${agentShares.shareConfig} ->> 'slug' = ${slug}`)
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

  /**
   * Enforce private-share owner access on an already-resolved share row.
   * Kept as the single access-check implementation so callers that already
   * hold a resolved row (e.g. via `findBySlugOrId`) don't need a second
   * lookup just to reuse the gate.
   */
  static assertShareAccess = (
    share: Pick<AgentShareData, 'ownerId' | 'visibility'>,
    viewerId: string,
  ): void => {
    const isOwner = viewerId === share.ownerId;
    // NOT_FOUND, not FORBIDDEN: a paused (private) share must be
    // indistinguishable from a share that never existed, otherwise a
    // stranger can probe custom slugs / ids to learn which private shares
    // exist. Only the owner ever sees the private row.
    if (!isOwner && share.visibility === 'private') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
    }
  };

  /** Resolve a share and enforce private-share owner access. */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    viewerId: string,
  ): Promise<AgentShareData> => {
    const share = await AgentShareModel.findByShareId(db, shareId);

    if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });

    AgentShareModel.assertShareAccess(share, viewerId);

    return share;
  };
}
