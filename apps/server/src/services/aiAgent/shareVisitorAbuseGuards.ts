import type { LobeChatDatabase } from '@lobechat/database';
import type { CreateMessageParams, DBMessageItem } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel } from '@/database/models/message';
import type { CreateTopicParams } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import type { TopicItem } from '@/database/schemas';
import { agents, agentShares } from '@/database/schemas';

/**
 * Re-validate the share is still the SAME live `link` share this request was
 * authorized against, from INSIDE the same `agents.id FOR UPDATE` transaction
 * `AgentShareModel.lockScopedAgentRow` just took.
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
  visitorUserId: string,
  workspaceId?: string,
): Promise<void> => {
  const [share] = await tx
    .select({ id: agentShares.id })
    .from(agentShares)
    .innerJoin(agents, eq(agentShares.agentId, agents.id))
    .where(
      and(
        eq(agentShares.agentId, agentId),
        eq(agentShares.id, expectedShareId),
        workspaceId ? eq(agents.workspaceId, workspaceId) : isNull(agents.workspaceId),
        AgentShareModel.admits(visitorUserId),
      ),
    );

  if (!share || share.id !== expectedShareId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }
};

/**
 * Write a share visitor's new topic only while the share is still the live
 * `link` share this request was authorized against.
 *
 * No share setting caps how many topics a visitor has: the visitor's budget is
 * the number of messages they send (`reserveShareVisitorTurn`). This guard only
 * closes the pause race: `AgentShareModel.lockScopedAgentRow` takes `FOR UPDATE`
 * on the SAME `agents.id` row every share-mutation path locks (`create`,
 * `updateConfig`, `updateVisibility`, `deleteByAgentId`), so an owner who makes
 * the link private mid-request never gets a row written under the stale
 * authorization.
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
  /** The visitor the topic is for: a `card` share admits only its grantees. */
  visitorUserId: string;
  workspaceId?: string;
}): Promise<TopicItem> => {
  const { agentId, create, db, expectedShareId, ownerId, visitorUserId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: a deleted/transferred/no-longer-owned agent never gets a
    // new visitor topic, same as every other share-mutation path locking this
    // row — see `lockScopedAgentRow`'s JSDoc.
    const locked = await AgentShareModel.lockScopedAgentRow(tx, agentId, {
      userId: ownerId,
      workspaceId,
    });
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written.
    await assertShareStillAuthorized(tx, agentId, expectedShareId, visitorUserId, workspaceId);

    return create(
      new TopicModel(tx, ownerId, workspaceId, undefined, { includeShareVisitor: true }),
    );
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
 * Atomically enforce `maxMessagesPerVisitor` at the exact moment a share
 * visitor's message is written.
 *
 * Callers may pre-check the count before dispatch (a fast reject that skips
 * wasted agent-config/tool-resolution work), but that read and the actual
 * user-message INSERT, deep in `execAgent`, are separate statements with
 * nothing serializing them: a burst of concurrent sends could all pass the
 * pre-check and all insert.
 *
 * Locked via `AgentShareModel.lockScopedAgentRow` — the SAME `agents.id FOR
 * UPDATE` row every share-mutation path locks — so whichever of two concurrent
 * sends loses the lock recounts the first one's committed message, and the cap
 * read below also conflicts with a concurrent `updateConfig`. The cap is read
 * inside the lock rather than accepted from the caller, so an owner's
 * mid-flood reduction is the number actually enforced. The trade-off is coarser
 * contention (this serializes every visitor's send to the same agent), which
 * is acceptable: each transaction is a single count-then-insert with no
 * external I/O.
 */
export const reserveShareVisitorTurnOrThrow = async (params: {
  agentId: string;
  create: (messageModel: MessageModel) => Promise<DBMessageItem | undefined>;
  db: LobeChatDatabase;
  /** See {@link reserveShareVisitorTopicOrThrow}'s `expectedShareId` param JSDoc. */
  expectedShareId: string;
  ownerId: string;
  visitorUserId: string;
  workspaceId?: string;
}): Promise<DBMessageItem | undefined> => {
  const { agentId, create, db, expectedShareId, ownerId, visitorUserId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // Fail closed: same ownership/existence check as the topic guard.
    const locked = await AgentShareModel.lockScopedAgentRow(tx, agentId, {
      userId: ownerId,
      workspaceId,
    });
    if (!locked) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    // Fail closed BEFORE any row is written.
    await assertShareStillAuthorized(tx, agentId, expectedShareId, visitorUserId, workspaceId);

    // Fresh read under the lock, not a caller-supplied value.
    const { maxMessagesPerVisitor } = await AgentShareModel.readCurrentVisitorCaps(tx, agentId);
    const sent = await new TopicModel(tx, ownerId, workspaceId, undefined, {
      includeShareVisitor: true,
    }).countMessagesBySender({ agentId, senderId: visitorUserId });
    if (sent >= maxMessagesPerVisitor) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: ChatErrorType.ShareMessageLimitExceeded,
      });
    }

    // Share-runtime scope: visitor rows are excluded by default.
    return create(
      new MessageModel(tx, ownerId, workspaceId, undefined, { includeShareVisitor: true }),
    );
  });
};

/** Convenience wrapper so callers can pass `MessageModel.create`'s own params directly. */
export const reserveShareVisitorTurn = (
  params: {
    agentId: string;
    db: LobeChatDatabase;
    expectedShareId: string;
    ownerId: string;
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
