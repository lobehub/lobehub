import type { LobeChatDatabase } from '@lobechat/database';
import type { CreateMessageParams, DBMessageItem } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import type { CreateTopicParams } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import type { TopicItem } from '@/database/schemas';

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
 * `pg_advisory_xact_lock(hashtext(...))` inside a single transaction is the
 * same idiom `OnboardingService.sendOnboardingFirstMessage` uses to make its
 * own topic-provisioning idempotent under concurrency
 * (`apps/server/src/services/onboarding/index.ts:587-613`, serializing per
 * `userId:agentId`) — here keyed by `agentId:visitorUserId` to match
 * `TopicModel.countBySender`'s own scope. The recount and the INSERT both run
 * inside that one locked transaction, so whichever of two concurrent callers
 * loses the lock re-reads the FIRST caller's already-committed topic and
 * correctly rejects instead of also inserting.
 */
export const reserveShareVisitorTopicOrThrow = async (params: {
  agentId: string;
  create: (topicModel: TopicModel) => Promise<TopicItem>;
  db: LobeChatDatabase;
  maxTopicsPerVisitor: number;
  ownerId: string;
  visitorUserId: string;
  workspaceId?: string;
}): Promise<TopicItem> => {
  const { agentId, create, db, maxTopicsPerVisitor, ownerId, visitorUserId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    // hashtext() returns int4; pg_advisory_xact_lock takes bigint, so cast.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`agent-share-topic:${agentId}:${visitorUserId}`})::bigint)`,
    );

    const txTopicModel = new TopicModel(tx, ownerId, workspaceId);
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
    maxTopicsPerVisitor: number;
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
 * `shareChat.ts` pre-checks `MessageModel.countByTopic` against the cap
 * before dispatch, but the actual user-message INSERT happens later, deep in
 * `execAgentWithReservation`, on a separate statement with nothing
 * serializing the two. A burst of concurrent sends to the SAME topic can all
 * pass the pre-check and all insert, exceeding `maxTurnsPerTopic` by an
 * arbitrary amount (same review round, requirement to fix the whole class of
 * count-then-act guards, not just the one Codex named).
 *
 * Locked per `topicId` (not per visitor) because the cap is per-topic:
 * `pg_advisory_xact_lock(hashtext('agent-share-turn:' + topicId))`, same
 * cast-to-bigint idiom as every other advisory-lock call site in this
 * codebase (`onboarding/index.ts`, `goalGraph.ts`, `taskResultBridge/index.ts`,
 * `document/index.ts`).
 */
export const reserveShareVisitorTurnOrThrow = async (params: {
  create: (messageModel: MessageModel) => Promise<DBMessageItem | undefined>;
  db: LobeChatDatabase;
  maxTurnsPerTopic: number;
  ownerId: string;
  topicId: string;
  workspaceId?: string;
}): Promise<DBMessageItem | undefined> => {
  const { create, db, maxTurnsPerTopic, ownerId, topicId, workspaceId } = params;

  return db.transaction(async (trx) => {
    const tx = trx as unknown as LobeChatDatabase;

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`agent-share-turn:${topicId}`})::bigint)`,
    );

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
    db: LobeChatDatabase;
    maxTurnsPerTopic: number;
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
