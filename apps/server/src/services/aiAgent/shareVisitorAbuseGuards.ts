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
 * Re-validate the share is still the SAME live `link` share this request was
 * authorized against, from INSIDE the same `agents.id FOR UPDATE` transaction
 * `AgentShareModel.lockOwnedAgentRow` just took.
 *
 * WHY this must run BEFORE the topic/message INSERT the two guard functions
 * below perform, not only later: an owner who makes the link private while a
 * visitor's request is mid-flight must never get ANY row written under the
 * stale authorization.
 *
 * `expectedShareId` is checked alongside `visibility === 'link'` because the
 * row can also be replaced by a different instance (a hard delete via
 * `AgentShareModel.deleteByAgentId`, or an agent delete + recreate), which a
 * bare visibility check would miss since the replacement is `link` too. See
 * `AgentShareGate.shareId`'s JSDoc. Fail closed on a missing row, a non-`link`
 * visibility, or an id mismatch.
 */
const assertShareStillAuthorized = async (
  tx: LobeChatDatabase,
  agentId: string,
  expectedShareId: string,
): Promise<void> => {
  const [share] = await tx
    .select({ id: agentShares.id, visibility: agentShares.visibility })
    .from(agentShares)
    .where(eq(agentShares.agentId, agentId));

  if (!share || share.visibility !== 'link' || share.id !== expectedShareId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }
};

/**
 * Atomically enforce `maxTopicsPerVisitor` at the exact moment a share
 * visitor's new topic is written.
 *
 * `shareChat.ts` runs a `TopicModel.countBySender` pre-check before ever
 * dispatching to `AiAgentService.execAgent` (a fast, UX-only reject that skips
 * wasted agent-config/tool-resolution work for an obviously-over-cap request),
 * but that read and the actual `topics` INSERT this function performs are two
 * unrelated statements, on two unrelated requests/connections, with nothing
 * serializing them. Concurrent new-topic requests from the same visitor can
 * all observe the same pre-insert count and all insert.
 *
 * `AgentShareModel.lockOwnedAgentRow` takes `FOR UPDATE` on the SAME
 * `agents.id` row every other share-mutation path locks (`create`,
 * `updateConfig`, `updateVisibility`, `deleteByAgentId`). The recount and the
 * INSERT both run inside that one locked transaction, so whichever of two
 * concurrent callers loses the lock re-reads the FIRST caller's
 * already-committed topic and correctly rejects instead of also inserting.
 * Reusing the Agent row lock (rather than a visitor-keyed advisory lock) also
 * makes the cap read below conflict with a concurrent `updateConfig`, so a
 * recount can never straddle an owner's cap reduction.
 *
 * The cap itself is read via `AgentShareModel.readCurrentVisitorCaps` from
 * INSIDE this same locked transaction — deliberately NOT accepted as a
 * caller-supplied number. `shareChat.ts` resolves `shareConfig` exactly ONCE,
 * long before `AiAgentService` reaches this function (agent-config/tool/
 * knowledge-base resolution in between), so a caller-supplied cap would be a
 * stale snapshot an owner's mid-flood reduction could never affect.
 */
export const reserveShareVisitorTopicOrThrow = async (params: {
  agentId: string;
  create: (topicModel: TopicModel) => Promise<TopicItem>;
  db: LobeChatDatabase;
  /**
   * The `agentShares.id` the caller resolved this request against
   * (`AgentShareGate.shareId`) — re-checked fresh under this same row lock via
   * {@link assertShareStillAuthorized} before anything is inserted.
   */
  expectedShareId: string;
  ownerId: string;
  visitorUserId: string;
  workspaceId?: string;
}): Promise<TopicItem> => {
  const { agentId, create, db, expectedShareId, ownerId, visitorUserId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: a deleted/transferred/no-longer-owned agent never gets a
    // new visitor topic, same as every other share-mutation path locking this
    // row — see `lockOwnedAgentRow`'s JSDoc.
    const locked = await AgentShareModel.lockOwnedAgentRow(tx, agentId, ownerId);
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written.
    await assertShareStillAuthorized(tx, agentId, expectedShareId);

    // Fresh read under the lock, not a caller-supplied value — see this
    // function's JSDoc for the stale-cap flood this closes.
    const { maxTopicsPerVisitor } = await AgentShareModel.readCurrentVisitorCaps(tx, agentId);

    // Share-runtime scope: countBySender reads through `mine()` (visitor-
    // inclusive by construction) so this flag is redundant here, but pass it
    // so any later read added to this guard doesn't silently fail closed.
    const txTopicModel = new TopicModel(tx, ownerId, workspaceId, undefined, {
      includeShareVisitor: true,
    });
    const currentCount = await txTopicModel.countBySender({ agentId, senderId: visitorUserId });

    // Fail closed: a visitor already at (or somehow past) the cap never gets
    // another topic, even if `create`'s own params disagree with `agentId`.
    if (currentCount >= maxTopicsPerVisitor) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: ChatErrorType.ShareTopicLimitExceeded,
      });
    }

    return create(txTopicModel);
  });
};

/** Convenience wrapper so callers can pass `TopicModel.create`'s own params directly. */
export const reserveShareVisitorTopic = (
  params: {
    agentId: string;
    db: LobeChatDatabase;
    expectedShareId: string;
    ownerId: string;
    visitorUserId: string;
    workspaceId?: string;
  },
  createParams: CreateTopicParams,
  id?: string,
): Promise<TopicItem> =>
  reserveShareVisitorTopicOrThrow({
    ...params,
    create: (topicModel) => topicModel.create(createParams, id),
  });

/**
 * Atomically enforce `maxTurnsPerTopic` at the exact moment a share visitor's
 * user-turn message is written.
 *
 * Structurally the same race as {@link reserveShareVisitorTopicOrThrow}:
 * `shareChat.ts` pre-checks `MessageModel.countByTopic` against the cap before
 * dispatch, but the actual user-message INSERT happens later, deep in
 * `execAgent`, on a separate statement with nothing serializing the two. A
 * burst of concurrent sends to the SAME topic can all pass the pre-check and
 * all insert.
 *
 * Locked via `AgentShareModel.lockOwnedAgentRow` — the SAME `agents.id FOR
 * UPDATE` row {@link reserveShareVisitorTopicOrThrow} and every other
 * share-mutation path lock, not a topic-scoped lock, so the cap read below
 * also conflicts with a concurrent `updateConfig`. The trade-off is coarser
 * contention (this serializes against every OTHER topic's reservation for the
 * same agent), which is acceptable: these transactions are a single
 * count-then-insert each, with no external I/O.
 */
export const reserveShareVisitorTurnOrThrow = async (params: {
  agentId: string;
  create: (messageModel: MessageModel) => Promise<DBMessageItem | undefined>;
  db: LobeChatDatabase;
  /** See {@link reserveShareVisitorTopicOrThrow}'s `expectedShareId` param JSDoc. */
  expectedShareId: string;
  ownerId: string;
  topicId: string;
  workspaceId?: string;
}): Promise<DBMessageItem | undefined> => {
  const { agentId, create, db, expectedShareId, ownerId, topicId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: same ownership/existence check as the topic guard.
    const locked = await AgentShareModel.lockOwnedAgentRow(tx, agentId, ownerId);
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written.
    await assertShareStillAuthorized(tx, agentId, expectedShareId);

    // Fresh read under the lock, not a caller-supplied value.
    const { maxTurnsPerTopic } = await AgentShareModel.readCurrentVisitorCaps(tx, agentId);

    // Share-runtime scope: countByTopic reads through `ownership()`, which
    // now excludes visitor rows by default — the visitor topic's rows would
    // never be counted without opting in.
    const txMessageModel = new MessageModel(tx, ownerId, workspaceId, undefined, {
      includeShareVisitor: true,
    });
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
    expectedShareId: string;
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
