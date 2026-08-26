import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { isHeterogeneousAgentConfig } from '@lobechat/const';
import type { ChatTopicMetadata, LobeAgentAgencyConfig, ShareVisibility } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, lt, notInArray, or, sql } from 'drizzle-orm';

import type { AgentShareConfig, AgentShareConfigPatch, AgentShareItem } from '../schemas';
import {
  agents,
  agentShareGenerations,
  agentShareRunReservations,
  agentShares,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { bumpAgentShareGeneration, readAgentShareGeneration } from '../utils/agentShareGeneration';
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

/**
 * Whether `patch` NARROWS the creator-data surface `previous` already
 * granted — the only kind of `shareConfig` change that must invalidate a run
 * standing on the old grants. Field-by-field, because tightening one field
 * (e.g. dropping a tool) alongside loosening another (e.g. enabling
 * `allowReadMemory`) must still be treated as a tightening overall: a
 * visitor's in-flight run could otherwise keep reading data the owner just
 * tried to lock down.
 *
 * Deliberately excludes `maxTopicsPerVisitor` / `maxTurnsPerTopic` and
 * `uploadAllowed`, but for two DIFFERENT reasons — do not conflate them:
 *
 * - `maxTopicsPerVisitor` / `maxTurnsPerTopic` gate a NEW resource being
 *   created (a topic/turn that does not exist yet), never access to data an
 *   ALREADY-STANDING run is holding — so there is no in-flight run whose
 *   grants need invalidating. This is NOT the same as "re-read fresh
 *   per-call and therefore safe to ignore here": an earlier version of this
 *   comment claimed `shareChat.ts` re-reads them fresh on every call, but the
 *   value it read was still `AgentShareGate.shareConfig` — a snapshot taken
 *   ONCE at `findByShareIdWithAccessCheck`, long before
 *   `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
 *   actually take their advisory lock and recount (thousands of lines of
 *   agent-config/tool/knowledge-base resolution later — see those functions'
 *   JSDoc). A concurrent flood already past that initial read would keep
 *   inserting against the OLD, higher cap even after the owner lowered it.
 *   The actual fix for that gap is `AgentShareModel.readCurrentVisitorCaps`,
 *   called by those guard functions from INSIDE their locked transaction
 *   instead of trusting a caller-supplied number — see its JSDoc. With that
 *   fix, "re-read fresh" is literally true, which is what makes it safe to
 *   leave these two fields OUT of a mechanism (generation bump + whole-run
 *   invalidation) designed for a different problem: they were never a
 *   run-duration grant to invalidate, only a per-write cap to enforce
 *   correctly at write time. Raising either cap is symmetric and needs no
 *   special handling either: a request that already inserted/rejected
 *   against the OLD, lower value just now has nothing to reconcile against a
 *   LATER increase.
 * - `uploadAllowed` has no runtime enforcement point at all today
 *   (`SettingsContent.tsx` ships it disabled, "coming soon") — nothing to
 *   invalidate. If it is wired into a run-duration grant later, add it here.
 */
const isConfigTightening = (previous: AgentShareConfig, patch: AgentShareConfigPatch): boolean => {
  if (patch.allowReadMemory === false && previous.allowReadMemory === true) return true;

  if (patch.enabledToolIds) {
    const nextAllowed = new Set(patch.enabledToolIds);
    const droppedATool = (previous.enabledToolIds ?? []).some((id) => !nextAllowed.has(id));
    if (droppedATool) return true;
  }

  if (patch.filePermissionConfig) {
    const prevFiles = previous.filePermissionConfig;
    const nextFiles = patch.filePermissionConfig;
    if (nextFiles.agentFiles === 'none' && prevFiles?.agentFiles === 'read') return true;
    if (nextFiles.knowledgeBase === 'none' && prevFiles?.knowledgeBase === 'read') return true;
  }

  return false;
};

/** An `agentShares` row with `shareConfig` filled via `normalizeAgentShareConfig` — the shape every mutator that touches config returns to callers. */
type NormalizedAgentShareItem = Omit<AgentShareItem, 'shareConfig'> & {
  shareConfig: AgentShareConfig;
};

/** Result of a share mutation that MAY trigger a run-invalidating restrictive change. */
interface ShareMutationResult<T> {
  /**
   * Set only when this call actually bumped `agentShareGenerations` — i.e. a
   * genuine tightening/revocation happened, not merely "this endpoint COULD
   * have caused one". Callers must schedule
   * `AiAgentService.interruptActiveShareRuns(agentId, revocationGeneration)`
   * post-commit if and only if this is defined.
   */
  revocationGeneration?: number;
  share: T | null;
}

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

  /**
   * Atomically merge client-owned fields while preserving sibling and legacy
   * JSON keys.
   *
   * When the merged patch NARROWS a grant a `link` share already exposed
   * (see `isConfigTightening`), this ALSO bumps `agentShareGenerations` in
   * the SAME `agents.id FOR UPDATE` transaction as the config write, and
   * returns the new value as `revocationGeneration`. Two things fall out of
   * doing the bump under that lock rather than after this call returns:
   *
   * 1. Any concurrent `assertRunnableForVisitor` racing this write is forced
   *    to observe EITHER the pre-tightening config with the OLD generation,
   *    or this write's result with the NEW one — never a stale config
   *    stamped with a generation that looks current. A request that read
   *    `shareConfig` before this write (e.g. `shareChat.ts`'s
   *    `findByShareIdWithAccessCheck`) carries that OLD generation forward as
   *    `shareGate.generation`; `assertRunnableForVisitor` compares it against
   *    the FRESH value under the lock and fails closed on a mismatch. See
   *    that method's JSDoc.
   * 2. The caller (the router) can hand `revocationGeneration` straight to
   *    `AiAgentService.interruptActiveShareRuns` to tear down every
   *    reservation/running-operation staked under the OLD grants — see
   *    `agentShareGenerations`'s JSDoc for why the cutoff must be exactly
   *    this value.
   *
   * Only a `link` share can have an in-flight visitor run to invalidate
   * (`assertRunnableForVisitor` refuses to stake a reservation for any other
   * visibility), so a tightening patch to a `private` share never bumps the
   * generation — nothing to protect against.
   */
  updateConfig = async (
    agentId: string,
    config: AgentShareConfigPatch,
  ): Promise<ShareMutationResult<NormalizedAgentShareItem>> =>
    (await this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [previous] = await tx
        .select({ shareConfig: agentShares.shareConfig, visibility: agentShares.visibility })
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));

      if (!previous) return { share: null };

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

      if (!updated) return { share: null };

      const share = { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };

      const tightened =
        previous.visibility === 'link' &&
        isConfigTightening(normalizeAgentShareConfig(previous.shareConfig), config);

      if (!tightened) return { share };

      const revocationGeneration = await bumpAgentShareGeneration(tx, agentId);
      return { revocationGeneration, share };
    })) ?? { share: null };

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
   *
   * `expectedGeneration` closes a SIBLING window: `shareConfig` (tool
   * allowlist, memory/file grants) is resolved once, at `shareChat.ts`'s
   * `findByShareIdWithAccessCheck`, and then snapshotted into the run's
   * runtime state for its whole lifetime (`AgentShareGate`,
   * `applyShareGateToAgentConfig`) — the visibility recheck above says
   * nothing about whether that snapshot is still valid. The caller passes
   * the `agentShareGenerations` value it observed alongside that config read;
   * this method re-reads the CURRENT value under the same lock and refuses
   * to stake a reservation unless they match. A tightening write
   * (`updateConfig`) always bumps the generation, so a mismatch here means
   * "this request's config snapshot predates a tightening that has since
   * committed" — fail closed instead of running with stale, over-broad
   * grants. See `agentShareGenerations`'s JSDoc.
   */
  /**
   * Read the CURRENT `maxTopicsPerVisitor` / `maxTurnsPerTopic` caps for an
   * agent's share, bypassing any snapshot the caller might already be
   * holding.
   *
   * WHY this must be a fresh read and not a value threaded through from
   * earlier in the request: `reserveShareVisitorTopicOrThrow` /
   * `reserveShareVisitorTurnOrThrow`
   * (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`) take an
   * advisory lock and recount existing topics/messages immediately before
   * the real INSERT — but `shareChat.ts`'s `execAgent` resolves the share
   * (and therefore these caps) exactly ONCE, at `findByShareIdWithAccessCheck`,
   * long before that lock is taken. `AiAgentService.execAgentWithReservation`
   * does thousands of lines of agent-config/tool/knowledge-base resolution in
   * between (real I/O, not instant). A caller that passed the SNAPSHOTTED cap
   * into those guard functions would let an owner's cap REDUCTION lose to
   * every request already past that initial read: the locked recount would
   * only ever enforce whatever number it was TOLD, not the number the owner
   * currently has configured — during an active flood, lowering 50 topics to
   * 1 would still let every already-in-flight request reach 50. Calling this
   * method from INSIDE the SAME locked transaction those guard functions hold
   * closes that gap: the recount always compares against the cap as of RIGHT
   * NOW, not as of request entry.
   *
   * This is deliberately a much lighter fix than the generation-bump +
   * whole-run invalidation `isConfigTightening` drives for `allowReadMemory` /
   * `enabledToolIds` / `filePermissionConfig`: those fields gate ongoing
   * access an ALREADY-RUNNING operation is holding, so a stale snapshot must
   * tear the whole run down. `maxTopicsPerVisitor` / `maxTurnsPerTopic` only
   * gate whether a NEW topic/turn may be created — there is no in-flight run
   * to invalidate, only a single upcoming write to check against the right
   * number. See `isConfigTightening`'s JSDoc for why these two fields stay
   * OUT of that mechanism even after this fix.
   *
   * Falls back to `normalizeAgentShareConfig`'s defaults exactly like every
   * other reader of `agentShares.shareConfig`, so a legacy row missing these
   * keys still enforces the same baseline (5 topics / 20 turns) instead of
   * `undefined >= count` silently passing.
   */
  static readCurrentVisitorCaps = async (
    db: LobeChatDatabase,
    agentId: string,
  ): Promise<Pick<AgentShareConfig, 'maxTopicsPerVisitor' | 'maxTurnsPerTopic'>> => {
    const [row] = await db
      .select({ shareConfig: agentShares.shareConfig })
      .from(agentShares)
      .where(eq(agentShares.agentId, agentId));

    const normalized = normalizeAgentShareConfig(row?.shareConfig ?? null);
    return {
      maxTopicsPerVisitor: normalized.maxTopicsPerVisitor,
      maxTurnsPerTopic: normalized.maxTurnsPerTopic,
    };
  };

  assertRunnableForVisitor = async (params: {
    agentId: string;
    expectedGeneration: number;
    operationId: string;
    topicId: string;
    visitorUserId: string;
  }): Promise<void> => {
    const { agentId, expectedGeneration, operationId, topicId, visitorUserId } = params;

    const runnable = await this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [share] = await tx
        .select({ visibility: agentShares.visibility })
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId));

      if (share?.visibility !== 'link') return false;

      const currentGeneration = await readAgentShareGeneration(tx, agentId);
      if (currentGeneration !== expectedGeneration) return false;

      // Durable claim, written under the SAME lock/transaction as the
      // visibility check above — see this method's JSDoc. `generation` is
      // what lets a later revocation scope its cleanup to reservations that
      // predate it instead of every pending reservation for the agent.
      await tx.insert(agentShareRunReservations).values({
        agentId,
        generation: currentGeneration,
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
        .returning({
          generation: agentShareRunReservations.generation,
          id: agentShareRunReservations.id,
        });

      if (!reservation) return false;

      const [existingTopic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(eq(topics.id, topicId))
        .for('update');

      // Carry the reservation's generation onto the durable marker so a
      // LATER revocation's `findActiveVisitorRunTopics` sweep (which no
      // longer has the reservation row to read, since it was just deleted
      // above) can still scope itself to runs that predate it. See
      // `ChatTopicMetadata.runningOperation.shareGeneration`'s JSDoc.
      await tx
        .update(topics)
        .set({
          metadata: {
            ...existingTopic?.metadata,
            runningOperation: { ...runningOperation, shareGeneration: reservation.generation },
          },
        })
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
   * Revoke every still-pending reservation for an agent that predates
   * `revocationGeneration` — called right after a revocation write
   * (`deleteByAgentId` / `updateVisibility('private')` / tightening
   * `updateConfig` / `writeAgentConfigWithShareReset`) commits, passing the
   * EXACT generation that write just bumped to.
   *
   * `generation < revocationGeneration`, not a bare `agentId` match: a
   * reservation staked by a request that observed `revocationGeneration` or
   * later was authorized AFTER this specific revocation (e.g. a republish
   * that raced this call's own deferred `after()` scheduling) and must
   * survive it — see `agentShareGenerations`'s JSDoc for the republish
   * scenario this closes.
   *
   * A single `DELETE ... WHERE revoked_at IS NULL`, not a query loop: for any
   * reservation whose run is concurrently inside `confirmReservation`, this
   * statement blocks on that row until the confirm transaction commits or
   * rolls back (ordinary Postgres row locking — see `confirmReservation`'s
   * JSDoc), so by the time this call returns, every reservation it could
   * possibly race against has already been resolved one way or the other.
   * No fixed retry window, no missed operations.
   *
   * DELETE, not the soft `revoked_at` UPDATE this used before: nothing in the
   * repository ever reads a row once it is revoked (`confirmReservation`'s
   * `WHERE revoked_at IS NULL` already treats it as gone, and no admin/audit
   * view queries revoked rows), so leaving it in place only grew the table
   * forever — the exact orphan-accumulation class flagged for abandoned
   * `agent_operations` rows, but with no cleanup path at all here. Deleting
   * outright keeps `confirmReservation`'s existing "missing row → fail
   * closed" behavior (it only ever checked `WHERE id = operationId`, not
   * whether the row still physically exists) while actually bounding table
   * growth. See `sweepAbandonedReservations` for the complementary case this
   * does NOT cover: a reservation nobody ever revokes because the owner never
   * touches the share again.
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
    revocationGeneration: number,
  ): Promise<Array<{ operationId: string; topicId: string }>> => {
    const rows = await this.db
      .delete(agentShareRunReservations)
      .where(
        and(
          eq(agentShareRunReservations.agentId, agentId),
          isNull(agentShareRunReservations.revokedAt),
          lt(agentShareRunReservations.generation, revocationGeneration),
        ),
      )
      .returning({
        operationId: agentShareRunReservations.id,
        topicId: agentShareRunReservations.topicId,
      });

    return rows;
  };

  /**
   * Durable backstop for a reservation whose owning request died before
   * reaching EITHER `confirmReservation` or the catch-path
   * `releaseReservation` (e.g. the process was killed between
   * `assertRunnableForVisitor` inserting the row and `createOperation`
   * returning). Nothing else in this table's lifecycle ever cleans such a row
   * up: `revokeReservations` only fires when the OWNER makes a NEW
   * revoking/tightening write, which may never happen again for an agent
   * whose share config the owner otherwise leaves untouched — so
   * deleting-on-revoke alone does not bound growth from THIS case. Every
   * long-lived shared agent that ever has one abandoned startup (deploy
   * mid-request, OOM, crashed pod) would otherwise accumulate one indexed row
   * per incident forever, same class as the abandoned-`agent_operations`
   * problem `AbandonOperationService` exists for — but that service is
   * triggered per-operation-id by a watchdog and has nothing to key a sweep
   * of THIS table off of, so this is its own minimal age-based sweep rather
   * than a hook into that one.
   *
   * Deletes by age alone (`createdAt < now - maxAgeMs`), not by status: after
   * the `revokeReservations` DELETE fix above, every row that still exists IS
   * pending by definition (a revoked or confirmed row no longer exists), so
   * there is no separate "pending vs revoked" branch to write — one filter
   * covers both the case this method exists for (abandoned pending rows) and,
   * as a harmless backstop, any row from before that fix that predates this
   * deploy.
   *
   * Safe to run on a row whose run is still genuinely standing up, however
   * unlikely at `maxAgeMs`'s default: deleting it just makes that run's own
   * `confirmReservation` return `false` and fail closed (interrupted, never
   * billed under the creator's budget) — the exact same outcome as an owner
   * revoking mid-startup, see that method's JSDoc. This is why `maxAgeMs`
   * must stay comfortably above any realistic `createOperation` duration
   * (gateway registration + state persistence + queue scheduling): the
   * default mirrors `VERIFY_ABANDONED_MS`
   * (`apps/server/src/services/verify/staleness.ts`), this codebase's
   * existing bar for "this durable claim has been outstanding far longer than
   * any real workload, so treat it as dead."
   *
   * A plain module function, not an `AgentShareModel` instance method: the
   * sweep is agent/owner-agnostic (it scans the whole table), so there is no
   * single `userId` to construct an instance around.
   */
  static sweepAbandonedReservations = async (
    db: LobeChatDatabase,
    maxAgeMs: number = 30 * 60 * 1000,
  ): Promise<Array<{ operationId: string; topicId: string }>> => {
    const cutoff = new Date(Date.now() - maxAgeMs);

    const rows = await db
      .delete(agentShareRunReservations)
      .where(lt(agentShareRunReservations.createdAt, cutoff))
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
   *
   * `link → private` also bumps `agentShareGenerations` in the SAME
   * transaction and returns the new value as `revocationGeneration`, for the
   * caller to hand to `AiAgentService.interruptActiveShareRuns` — see that
   * method's JSDoc and `updateConfig`'s JSDoc (same pattern). Publishing
   * (`link`) never bumps it: no run needs invalidating on a grant, and a
   * fresh reservation staked right after this call will simply observe the
   * generation as-is.
   */
  updateVisibility = async (
    agentId: string,
    visibility: ShareVisibility,
  ): Promise<ShareMutationResult<NormalizedAgentShareItem>> =>
    (await this.withOwnedPersonalAgentLock(agentId, async (tx, agent) => {
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

      if (!updated) return { share: null };

      const share = { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) };

      if (visibility !== 'private') return { share };

      const revocationGeneration = await bumpAgentShareGeneration(tx, agentId);
      return { revocationGeneration, share };
    })) ?? { share: null };

  /**
   * Disable sharing by deleting the agent's share record. Bumps
   * `agentShareGenerations` in the SAME transaction as the delete (same
   * pattern as `updateVisibility('private')`) and returns the new value as
   * `revocationGeneration` — the counter lives in its own table keyed off
   * `agents.id` specifically so it survives this delete (and any later
   * re-`create()`); see `agentShareGenerations`'s JSDoc.
   */
  deleteByAgentId = async (agentId: string): Promise<ShareMutationResult<AgentShareItem>> =>
    (await this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [deleted] = await tx
        .delete(agentShares)
        .where(eq(agentShares.agentId, agentId))
        .returning();

      if (!deleted) return { share: null };

      const revocationGeneration = await bumpAgentShareGeneration(tx, agentId);
      return { revocationGeneration, share: deleted };
    })) ?? { share: null };

  /**
   * Resolve the public metadata required by an agent share page.
   *
   * `generation` is LEFT JOINed (defaulting to the baseline `1` via
   * `COALESCE`, mirroring `readAgentShareGeneration`) rather than read
   * separately: an agent whose share has never had a restrictive change has
   * no `agentShareGenerations` row at all. Every visitor request threads this
   * value through as `AgentShareGate.generation` and `assertRunnableForVisitor`
   * re-checks it under the row lock right before staking a run — see that
   * method's JSDoc.
   */
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
        generation: sql<number>`COALESCE(${agentShareGenerations.generation}, 1)`,
        ownerId: agents.userId,
        shareConfig: agentShares.shareConfig,
        shareId: agentShares.id,
        userViewCount: agentShares.userViewCount,
        visibility: agentShares.visibility,
      })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .leftJoin(agentShareGenerations, eq(agentShareGenerations.agentId, agentShares.agentId))
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
