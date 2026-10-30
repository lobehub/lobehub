// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import * as messageModule from '../../message';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-public-api-user';

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

/**
 * Every public instance method of `MessageModel`. They are bound arrow
 * properties, so callers may destructure them or pass them around detached.
 */
const PUBLIC_INSTANCE_METHODS = [
  'addFiles',
  'batchCreate',
  'batchDeleteByAgentId',
  'count',
  'countApproximate',
  'countByTopic',
  'countGroupByTopic',
  'countUpTo',
  'countWords',
  'create',
  'createMessageQuery',
  'createUserAndAssistantMessages',
  'deleteAllMessages',
  'deleteMessage',
  'deleteMessageQuery',
  'deleteMessages',
  'deleteMessagesBySession',
  'deleteMessageTranslate',
  'deleteMessageTTS',
  'findById',
  'findByClientId',
  'findFirstAssistantInTopic',
  'findLatestAssistantByOperationId',
  'findLatestAssistantMessageByThread',
  'findLatestPluginStateInTopic',
  'findMessagePlugin',
  'findMessageQueriesById',
  'findShareVisitorMessageIds',
  'findToolMessageIdByToolCallId',
  'findTrashedByIds',
  'findVerifyMessageByOperationId',
  'getHeatmaps',
  'getLastMainThreadSpineMessageId',
  'getLatestNonToolMessageId',
  'getLatestSpineMessageId',
  'getThreadParentMessages',
  'getTokenHeatmaps',
  'hasMoreThanN',
  'hasTopicMessages',
  'isMessageDescendantOf',
  'listMessagePluginsByIds',
  'listMessagePluginsByTopic',
  'listMessagePluginsForOperation',
  'purgeMessages',
  'query',
  'queryAll',
  'queryByIds',
  'queryByKeyword',
  'queryBySessionId',
  'queryForVisitor',
  'queryLastUserMessageByTopics',
  'queryTopicMessagesByCursor',
  'queryTopicMessageTree',
  'queryTopicTranscript',
  'queryWithWhere',
  'rankModels',
  'resolveHumanApproval',
  'restoreHumanApproval',
  'restoreMessages',
  'softDeleteMessages',
  'softDeleteTopicless',
  'topicMessageStats',
  'update',
  'updateMessagePlugin',
  'updateMetadata',
  'updatePluginState',
  'updateToolArguments',
  'updateToolMessage',
  'updateTranslate',
  'updateTTS',
] as const;

describe('MessageModel public API', () => {
  it('exposes every public method as an own function property', () => {
    const model = new MessageModel(serverDB, userId);

    for (const name of PUBLIC_INSTANCE_METHODS) {
      expect(Object.prototype.hasOwnProperty.call(model, name), name).toBe(true);
      expect(typeof model[name], name).toBe('function');
    }
  });

  it('keeps updateMessageRAG on the prototype and checkUsersHaveMessages static', () => {
    expect(typeof MessageModel.prototype.updateMessageRAG).toBe('function');
    expect(typeof MessageModel.checkUsersHaveMessages).toBe('function');
  });

  it('keeps the runtime exports of the module entry', () => {
    expect(Object.keys(messageModule).sort()).toEqual([
      'HumanApprovalAlreadyResolvedError',
      'MESSAGE_KEYWORD_SEARCH_MAX_LIMIT',
      'MessageModel',
      'redactCreatorPrivateBlob',
      'sanitizeVisitorError',
      'toVisitorMessage',
    ]);
  });

  it('runs detached methods against the instance scope', async () => {
    const model = new MessageModel(serverDB, userId);
    const { count, create, deleteMessage, findById, queryByIds, update } = model;

    const created = await create({ content: 'hello', role: 'user' });
    await update(created.id, { content: 'hello again' });

    expect((await findById(created.id))?.content).toBe('hello again');
    expect((await queryByIds([created.id])).map((m) => m.id)).toEqual([created.id]);
    expect(await count()).toBe(1);

    await deleteMessage(created.id);

    expect(await findById(created.id)).toBeUndefined();
    expect(await count()).toBe(0);
  });

  it('scopes detached methods to the constructing user', async () => {
    const otherUserId = 'message-public-api-other';
    await serverDB.delete(users).where(eq(users.id, otherUserId));
    await serverDB.insert(users).values([{ id: otherUserId }]);

    try {
      const created = await new MessageModel(serverDB, userId).create({
        content: 'mine',
        role: 'user',
      });
      const { count, findById } = new MessageModel(serverDB, otherUserId);

      expect(await findById(created.id)).toBeUndefined();
      expect(await count()).toBe(0);
    } finally {
      await serverDB.delete(users).where(eq(users.id, otherUserId));
    }
  });
});
