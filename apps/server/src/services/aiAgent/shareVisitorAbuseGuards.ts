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

/**
 * Re-validate the share is still `link`, from INSIDE the same `agents.id FOR
 * UPDATE` transaction `AgentShareModel.lockOwnedAgentRow` just took (see
 * `shareVisitorAbuseGuards.ts:100`).
 *
 * WHY this must run BEFORE the topic/message INSERT the two guard functions
 * below perform: checking HERE, before any row exists, means an owner who
 * makes the link private while a visitor's request is mid-flight never gets
 * ANY row written under the stale authorization in the first place — rather
 * than relying solely on the plain visibility recheck `AiAgentService`
 * performs right before `createOperation` (by which point the topic and the
 * visitor's user message would already be persisted; see
 * `cleanupRejectedShareVisitorTurn`'s defense-in-depth for the remaining,
 * unavoidable window between this check and that one).
 *
 * A disable → re-enable cycle mints a brand new `agentShares.id`; a stale
 * request that started under the OLD instance is not distinguished here from
 * one against the freshly-recreated instance beyond the plain `visibility ===
 * 'link'` check. Accepted tradeoff: the plain visibility check is the sole
 * gate for this race.
 */
const assertShareStillAuthorized = async (tx: LobeChatDatabase, agentId: string): Promise<void> => {
  const [share] = await tx
    .select({ visibility: agentShares.visibility })
    .from(agentShares)
    .where(eq(agentShares.agentId, agentId));

  if (share?.visibility !== 'link') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }
};

/**
 * Atomically enforce `maxTopicsPerVisitor` at the exact moment a share
 * visitor's new topic is written.
 *
 * `shareChat.ts` runs a `TopicModel.countVisitorShareTopics` pre-check before ever
 * dispatching to `AiAgentService.execAgent` (a fast, UX-only reject that
 * skips wasted agent-config/tool-resolution work for an obviously-over-cap
 * request — see that router's JSDoc), but that read and the actual `topics`
 * INSERT this function performs are two unrelated statements, on two
 * unrelated requests/connections, with nothing serializing them. Concurrent
 * new-topic requests from the same visitor can all observe the same
 * pre-insert count and all insert (see `shareChat.ts:129`).
 *
 * `AgentShareModel.lockOwnedAgentRow` takes `FOR UPDATE` on the SAME
 * `agents.id` row every other share-mutation path locks (`create`,
 * `updateConfig`, `updateVisibility`, `deleteByAgentId` — see
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
 * write commit a LOWER one, then insert against the stale number anyway.
 *
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
 * has configured right now. See `readCurrentVisitorCaps`'s JSDoc.
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
  ownerId: string;
  visitorUserId: string;
  workspaceId?: string;
}): Promise<TopicItem> => {
  const { agentId, create, db, ownerId, visitorUserId, workspaceId } = params;

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
    // JSDoc for why this must run here and not only later, in the plain
    // pre-run visibility recheck in `AiAgentService.execAgent`.
    await assertShareStillAuthorized(tx, agentId);

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

    // Visitor-scoped: the topic being reserved is the VISITOR's row (see
    // `shareChat.ts`'s module JSDoc), so both the recount and the INSERT
    // `create` performs must run under the visitor's identity. `ownerId`
    // stays in play only for the `agents.id` row lock above, which is a
    // creator-owned row.
    const txTopicModel = new TopicModel(tx, visitorUserId, workspaceId);
    const currentCount = await txTopicModel.countVisitorShareTopics({ agentId, shareId });

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
 * `AiAgentService.execAgent`, on a separate statement with nothing
 * serializing the two. A burst of concurrent sends to the SAME topic can all
 * pass the pre-check and all insert, exceeding `maxTurnsPerTopic` by an
 * arbitrary amount. Fixed as a class — every count-then-act guard here takes
 * the lock — rather than one site at a time.
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
 * count-then-insert each, no external I/O.
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
  ownerId: string;
  topicId: string;
  /** See {@link reserveShareVisitorTopicOrThrow}'s `visitorUserId` — the message row is theirs. */
  visitorUserId: string;
  workspaceId?: string;
}): Promise<DBMessageItem | undefined> => {
  const { agentId, create, db, ownerId, topicId, visitorUserId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: same ownership/existence check as the topic guard — see
    // `reserveShareVisitorTopicOrThrow`'s JSDoc.
    const locked = await AgentShareModel.lockOwnedAgentRow(tx, agentId, ownerId);
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written — see `assertShareStillAuthorized`'s
    // JSDoc for why this must run here and not only later, in the plain
    // pre-run visibility recheck in `AiAgentService.execAgent`.
    await assertShareStillAuthorized(tx, agentId);

    // Fresh read under the lock, not a caller-supplied value — see this
    // function's JSDoc for the stale-cap flood this closes.
    const { maxTurnsPerTopic } = await AgentShareModel.readCurrentVisitorCaps(tx, agentId);

    // Visitor-scoped for the same reason as the topic guard: the user-turn
    // message being counted and inserted is the visitor's own row.
    const txMessageModel = new MessageModel(tx, visitorUserId, workspaceId);
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
    ownerId: string;
    topicId: string;
    visitorUserId: string;
    workspaceId?: string;
  },
  createParams: CreateMessageParams,
  id?: string,
): Promise<DBMessageItem | undefined> =>
  reserveShareVisitorTurnOrThrow({
    ...params,
    create: (messageModel) => messageModel.create(createParams, id),
  });
