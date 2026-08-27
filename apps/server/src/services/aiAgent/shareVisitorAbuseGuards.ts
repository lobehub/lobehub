import type { LobeChatDatabase } from '@lobechat/database';
import type { CreateMessageParams, DBMessageItem } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel } from '@/database/models/message';
import type { CreateTopicParams } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import type { TopicItem } from '@/database/schemas';
import { agentShares } from '@/database/schemas';
import { readAgentShareGeneration } from '@/database/utils/agentShareGeneration';

/**
 * Re-validate the share is still `link` AND still on the generation the
 * caller observed, from INSIDE the same `agents.id FOR UPDATE` transaction
 * `AgentShareModel.lockOwnedAgentRow` just took — the fix for LOBE-11930
 * Codex P2 (`shareVisitorAbuseGuards.ts:100`).
 *
 * WHY this must run BEFORE the topic/message INSERT the two guard functions
 * below perform, not only later in `AgentShareModel.assertRunnableForVisitor`:
 * that method re-validates right before `createOperation`, but by then the
 * topic and the visitor's user message it guards are already persisted — a
 * rejection there does not by itself unwind them (see
 * `AiAgentService.execAgentWithReservation`'s `cleanupRejectedShareVisitorTurn`
 * for the defense-in-depth that covers the remaining, unavoidable window
 * between this check and that one). Checking HERE, before any row exists,
 * means an owner who makes the link private — or disables and republishes it,
 * see below — while a visitor's request is mid-flight never gets ANY row
 * written under the stale authorization in the first place;
 * `assertRunnableForVisitor` is a second gate, not the only one.
 *
 * `expectedGeneration`, not merely `visibility === 'link'`, is what closes the
 * disable → re-enable race: `AgentShareModel.create()` mints a brand new
 * `agentShares.id` every disable → re-enable cycle, so a stale request that
 * started under the OLD instance would otherwise pass a bare visibility check
 * (the NEW instance is also `link`) and get `readCurrentVisitorCaps`'s
 * freshly-read `shareId` stamped onto it — silently re-filing a
 * pre-revocation conversation under the REPLACEMENT share. Both
 * `updateVisibility('private')` and `deleteByAgentId` bump
 * `agentShareGenerations` unconditionally (see their JSDoc in
 * `packages/database/src/models/agentShare.ts`), so the generation a visitor
 * observed at `findByShareIdWithAccessCheck` time can never still match after
 * either. Fail closed on any mismatch or non-`link` visibility.
 */
const assertShareStillAuthorized = async (
  tx: LobeChatDatabase,
  agentId: string,
  expectedGeneration: number,
): Promise<void> => {
  const [share] = await tx
    .select({ visibility: agentShares.visibility })
    .from(agentShares)
    .where(eq(agentShares.agentId, agentId));

  if (share?.visibility !== 'link') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }

  const currentGeneration = await readAgentShareGeneration(tx, agentId);
  if (currentGeneration !== expectedGeneration) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }
};

/**
 * Atomically enforce `maxTopicsPerVisitor` at the exact moment a share
 * visitor's new topic is written.
 *
 * `shareChat.ts` runs a `TopicModel.countBySender` pre-check before ever
 * dispatching to `AiAgentService.execAgent` (a fast, UX-only reject that
 * skips wasted agent-config/tool-resolution work for an obviously-over-cap
 * request — see that router's JSDoc), but that read and the actual `topics`
 * INSERT this function performs are two unrelated statements, on two
 * unrelated requests/connections, with nothing serializing them. Concurrent
 * new-topic requests from the same visitor can all observe the same
 * pre-insert count and all insert — Codex P1, LOBE-11930 review round
 * (`shareChat.ts:129`).
 *
 * `AgentShareModel.lockOwnedAgentRow` takes `FOR UPDATE` on the SAME
 * `agents.id` row every other share-mutation path locks (`create`,
 * `updateConfig`, `updateVisibility`, `deleteByAgentId`,
 * `assertRunnableForVisitor` — see that method's JSDoc and
 * `withOwnedPersonalAgentLock`'s JSDoc for the full family). The recount and
 * the INSERT both run inside that one locked transaction, so whichever of two
 * concurrent callers loses the lock re-reads the FIRST caller's
 * already-committed topic and correctly rejects instead of also inserting.
 *
 * This used to be a separate `pg_advisory_xact_lock(hashtext(...))` keyed by
 * `agentId:visitorUserId` (the idiom `OnboardingService.sendOnboardingFirstMessage`
 * still uses for its own topic-provisioning idempotency,
 * `apps/server/src/services/onboarding/index.ts:587-613`) instead of this row
 * lock. That advisory lock only ever serialized concurrent VISITOR requests
 * against each other — it was a lock disjoint from anything `updateConfig`
 * takes, so a cap read inside it could still straddle a concurrent
 * `updateConfig` reduction: read the OLD (higher) cap, then have the owner's
 * write commit a LOWER one, then insert against the stale number anyway
 * (Codex P2, LOBE-11930 review round, `shareVisitorAbuseGuards.ts:71`).
 * Reusing the Agent row lock closes that gap for free — see
 * `withOwnedPersonalAgentLock`'s JSDoc for why the advisory lock is not kept
 * ALONGSIDE this one, and for the deadlock analysis of taking this lock from
 * a transaction this function opens itself rather than one `AgentShareModel`
 * opens internally.
 *
 * The cap itself is read via `AgentShareModel.readCurrentVisitorCaps` from
 * INSIDE this same locked transaction — deliberately NOT accepted as a
 * caller-supplied number. `shareChat.ts` resolves `shareConfig` exactly ONCE,
 * at `findByShareIdWithAccessCheck`, long before `AiAgentService` reaches this
 * function (thousands of lines of agent-config/tool/knowledge-base
 * resolution in between). A caller-supplied cap would therefore be that
 * stale snapshot: an owner lowering `maxTopicsPerVisitor` mid-flood would
 * never affect requests already past the initial read, since the locked
 * recount would keep enforcing the OLD, higher number it was handed. Reading
 * fresh here means the recount always compares against whatever the owner
 * has configured right now. See `readCurrentVisitorCaps`'s JSDoc and
 * `isConfigTightening`'s JSDoc (`AgentShareModel`) for why this fix, not a
 * generation bump, is the correct one for these two fields.
 */
export const reserveShareVisitorTopicOrThrow = async (params: {
  agentId: string;
  /**
   * `shareId` is the CURRENT `agentShares.id`, re-read fresh under this same
   * row lock (see `AgentShareModel.readCurrentVisitorCaps`'s JSDoc) — never
   * the caller's possibly-stale `AgentShareGate.shareId` snapshot. Callers
   * must stamp it onto the new topic's `topics.shareId` column so the row is
   * correctly scoped to the share instance that was ACTUALLY live at insert
   * time, not whichever instance the request started against.
   */
  create: (topicModel: TopicModel, shareId: string) => Promise<TopicItem>;
  db: LobeChatDatabase;
  /**
   * The `agentShareGenerations` value the caller observed alongside the
   * `shareConfig`/`shareId` it resolved this request against
   * (`AgentShareGate.generation`) — re-checked fresh under this same row
   * lock via {@link assertShareStillAuthorized} before anything is inserted.
   * See that function's JSDoc for the stale-authorization insert this closes
   * (LOBE-11930 Codex P2, `shareVisitorAbuseGuards.ts:100`).
   */
  expectedGeneration: number;
  ownerId: string;
  visitorUserId: string;
  workspaceId?: string;
}): Promise<TopicItem> => {
  const { agentId, create, db, expectedGeneration, ownerId, visitorUserId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: a deleted/transferred/no-longer-owned agent never gets a
    // new visitor topic, same as every other share-mutation path locking
    // this row — see `lockOwnedAgentRow`'s JSDoc.
    const locked = await AgentShareModel.lockOwnedAgentRow(tx, agentId, ownerId);
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written — see `assertShareStillAuthorized`'s
    // JSDoc for why this must run here and not only later, in
    // `assertRunnableForVisitor`.
    await assertShareStillAuthorized(tx, agentId, expectedGeneration);

    // Fresh read under the lock, not a caller-supplied value — see this
    // function's JSDoc and `readCurrentVisitorCaps`'s JSDoc for the
    // stale-cap flood and stale-`shareId` misfile this closes.
    const { maxTopicsPerVisitor, shareId } = await AgentShareModel.readCurrentVisitorCaps(
      tx,
      agentId,
    );

    // Fail closed: the row lock above already proved the agent is owned and
    // live, but a share disabled (and never re-enabled) between that lock
    // and this read has no `agentShares` row to stamp a new topic against.
    if (!shareId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    const txTopicModel = new TopicModel(tx, ownerId, workspaceId);
    const currentCount = await txTopicModel.countBySender({
      agentId,
      senderId: visitorUserId,
      shareId,
    });

    // Fail closed: a visitor already at (or somehow past) the cap never gets
    // another topic, even if `create`'s own params disagree with `agentId`.
    if (currentCount >= maxTopicsPerVisitor) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: ChatErrorType.ShareTopicLimitExceeded,
      });
    }

    return create(txTopicModel, shareId);
  });
};

/** Convenience wrapper so callers can pass `TopicModel.create`'s own params directly. */
export const reserveShareVisitorTopic = (
  params: {
    agentId: string;
    db: LobeChatDatabase;
    expectedGeneration: number;
    ownerId: string;
    visitorUserId: string;
    workspaceId?: string;
  },
  createParams: CreateTopicParams,
  id?: string,
): Promise<TopicItem> =>
  reserveShareVisitorTopicOrThrow({
    ...params,
    // Overrides any `shareId` already on `createParams` (e.g. the request's
    // stale `AgentShareGate.shareId` snapshot) with the freshly-locked
    // current value — see this function's JSDoc.
    create: (topicModel, shareId) => topicModel.create({ ...createParams, shareId }, id),
  });

/**
 * Atomically enforce `maxTurnsPerTopic` at the exact moment a share visitor's
 * user-turn message is written.
 *
 * Structurally the same race as {@link reserveShareVisitorTopicOrThrow}:
 * `shareChat.ts` pre-checks `MessageModel.countByTopic` against the cap
 * before dispatch, but the actual user-message INSERT happens later, deep in
 * `execAgentWithReservation`, on a separate statement with nothing
 * serializing the two. A burst of concurrent sends to the SAME topic can all
 * pass the pre-check and all insert, exceeding `maxTurnsPerTopic` by an
 * arbitrary amount (same review round, requirement to fix the whole class of
 * count-then-act guards, not just the one Codex named).
 *
 * Locked via `AgentShareModel.lockOwnedAgentRow` — the SAME `agents.id FOR
 * UPDATE` row {@link reserveShareVisitorTopicOrThrow} and every other
 * share-mutation path lock, not a topic-scoped lock. This used to be a
 * separate, finer-grained `pg_advisory_xact_lock(hashtext('agent-share-turn:'
 * + topicId))` (same cast-to-bigint idiom as `onboarding/index.ts`,
 * `goalGraph.ts`, `taskResultBridge/index.ts`, `document/index.ts`), keyed
 * per `topicId` so it only serialized concurrent sends to the SAME topic.
 * That lock never conflicted with a concurrent `updateConfig`, so a cap read
 * under it could still straddle a concurrent cap reduction — see
 * {@link reserveShareVisitorTopicOrThrow}'s JSDoc for the full before/after
 * and the deadlock analysis. The trade-off from reusing the Agent row lock
 * is coarser contention (this now serializes against every OTHER topic's
 * turn-reservation and topic-reservation for the same agent, not just this
 * one topic's), which is acceptable: these transactions are a single
 * count-then-insert each, no external I/O, and `assertRunnableForVisitor`
 * already takes this exact row lock once per run start on the very same
 * request path — this is not a new contention point, only the same one
 * applied consistently.
 *
 * Same stale-snapshot fix as {@link reserveShareVisitorTopicOrThrow}: the cap
 * is read fresh via `AgentShareModel.readCurrentVisitorCaps` from inside this
 * locked transaction (hence `agentId` is now a required param) rather than
 * accepted as a caller-supplied number carried forward from `shareChat.ts`'s
 * one-time share resolution. See that function's JSDoc for the flood this
 * closes.
 */
export const reserveShareVisitorTurnOrThrow = async (params: {
  agentId: string;
  create: (messageModel: MessageModel) => Promise<DBMessageItem | undefined>;
  db: LobeChatDatabase;
  /** See {@link reserveShareVisitorTopicOrThrow}'s `expectedGeneration` param JSDoc. */
  expectedGeneration: number;
  ownerId: string;
  topicId: string;
  workspaceId?: string;
}): Promise<DBMessageItem | undefined> => {
  const { agentId, create, db, expectedGeneration, ownerId, topicId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: same ownership/existence check as the topic guard — see
    // `reserveShareVisitorTopicOrThrow`'s JSDoc.
    const locked = await AgentShareModel.lockOwnedAgentRow(tx, agentId, ownerId);
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written — see `assertShareStillAuthorized`'s
    // JSDoc for why this must run here and not only later, in
    // `assertRunnableForVisitor`.
    await assertShareStillAuthorized(tx, agentId, expectedGeneration);

    // Fresh read under the lock, not a caller-supplied value — see this
    // function's JSDoc for the stale-cap flood this closes.
    const { maxTurnsPerTopic } = await AgentShareModel.readCurrentVisitorCaps(tx, agentId);

    const txMessageModel = new MessageModel(tx, ownerId, workspaceId);
    const turnCount = await txMessageModel.countByTopic({ role: 'user', topicId });

    if (turnCount >= maxTurnsPerTopic) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: ChatErrorType.ShareTurnLimitExceeded,
      });
    }

    return create(txMessageModel);
  });
};

/** Convenience wrapper so callers can pass `MessageModel.create`'s own params directly. */
export const reserveShareVisitorTurn = (
  params: {
    agentId: string;
    db: LobeChatDatabase;
    expectedGeneration: number;
    ownerId: string;
    topicId: string;
    workspaceId?: string;
  },
  createParams: CreateMessageParams,
  id?: string,
): Promise<DBMessageItem | undefined> =>
  reserveShareVisitorTurnOrThrow({
    ...params,
    create: (messageModel) => messageModel.create(createParams, id),
  });
