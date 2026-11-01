import { runTimedSinkStage as runTimedStage } from '@lobechat/utils';
import { and, inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { type CreateTopicParams, type ModelTimingContext, TopicModel } from '../../models/topic';
import { messages, type TopicItem } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { messageOwnership, type TopicRepositoryScope } from './scope';

/** Bounds the per-topic message re-parenting fan-out inside one transaction. */
const BATCH_CREATE_MESSAGE_UPDATE_CONCURRENCY = 5;

const topicModelFor = (scope: TopicRepositoryScope, db: LobeChatDatabase = scope.db) =>
  new TopicModel(db, scope.userId, scope.workspaceId);

const reparentMessages = (
  db: LobeChatDatabase,
  scope: TopicRepositoryScope,
  topicId: string,
  messageIds: string[],
) =>
  db
    .update(messages)
    .set({ topicId })
    .where(and(messageOwnership(scope), inArray(messages.id, messageIds)));

/**
 * Creates a topic and, when `messages` is given, re-parents those existing
 * messages onto it in the same transaction.
 *
 * Without messages this is a single-table insert ({@link TopicModel.create}) and
 * opens no transaction.
 */
export const createTopic = async (
  scope: TopicRepositoryScope,
  { messages: messageIds, ...params }: CreateTopicParams,
  id?: string,
  timing?: ModelTimingContext,
): Promise<TopicItem> => {
  if (!messageIds || messageIds.length === 0) {
    return topicModelFor(scope).create(params, id, timing);
  }

  return runTimedStage(
    timing,
    'db.topic.create.transaction',
    () =>
      scope.db.transaction(async (tx) => {
        const trx = tx as unknown as LobeChatDatabase;
        const topic = await topicModelFor(scope, trx).create(params, id, timing);

        await runTimedStage(
          timing,
          'db.topic.create.messages.updateTopic',
          () => reparentMessages(trx, scope, topic.id, messageIds),
          { messageCount: messageIds.length },
        );

        return topic;
      }),
    {
      hasAgentId: !!params.agentId,
      hasGroupId: !!params.groupId,
      hasSessionId: !!params.sessionId,
      messageCount: messageIds.length,
    },
  );
};

/**
 * Batch-creates topics and re-parents each topic's `messages` onto it, all in
 * one transaction.
 */
export const batchCreateTopics = async (
  scope: TopicRepositoryScope,
  topicParams: (CreateTopicParams & { id?: string })[],
) =>
  scope.db.transaction(async (tx) => {
    const trx = tx as unknown as LobeChatDatabase;
    const createdTopics = await topicModelFor(scope, trx).batchInsert(
      topicParams.map(({ messages: _messages, ...params }) => params),
    );

    await pMap(
      createdTopics,
      async (topic, index) => {
        const messageIds = topicParams[index].messages;
        if (messageIds && messageIds.length > 0) {
          await reparentMessages(trx, scope, topic.id, messageIds);
        }
      },
      { concurrency: BATCH_CREATE_MESSAGE_UPDATE_CONCURRENCY },
    );

    return createdTopics;
  });
