import { ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentOperations,
  agents,
  chatGroups,
  messages,
  sessions,
  threads,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import * as topicModule from '../../topic';
import { TopicModel } from '../../topic';

const userId = 'topic-char-user';
const otherUserId = 'topic-char-other';
const agentId = 'topic-char-agent';
const groupId = 'topic-char-group';
const sessionId = 'topic-char-session';

const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

/** Former private helpers; excluded so the pin only covers the public surface. */
const PRIVATE_MEMBERS = new Set([
  'genId',
  'matchContainer',
  'matchGroup',
  'matchKeywordScope',
  'matchSession',
  'messageOwnership',
  'mine',
  'notShareVisitor',
  'ownership',
  'trashScope',
  'workspaceScope',
]);

const PUBLIC_METHODS = [
  'appendRunningOperationChild',
  'armScheduledRun',
  'batchDelete',
  'batchDeleteByAgentId',
  'batchDeleteByGroupId',
  'batchDeleteBySessionId',
  'batchDeleteIncludingTrashed',
  'batchInsert',
  'cancelRateLimitContinuation',
  'count',
  'countBySender',
  'countShareVisitors',
  'countTopicsForMemoryExtractor',
  'create',
  'delete',
  'deleteAll',
  'findByAgentAndDocumentTrigger',
  'findById',
  'findByIds',
  'findOwnTopicById',
  'findOwnTopicsByIds',
  'findOwnersByIds',
  'findRecentByBotThread',
  'findRunInitiators',
  'findShareVisitorTopicIds',
  'findTrashedByIds',
  'getCronTopicsGroupedByCronJob',
  'isRunningOperationAlive',
  'listTopicsForMemoryExtractor',
  'markRead',
  'patchRunningOperation',
  'purge',
  'query',
  'queryByKeyword',
  'queryBySender',
  'queryRecent',
  'queryTopics',
  'rank',
  'recomputeUsage',
  'releaseTaskCallbackReservation',
  'removeRunningOperationChild',
  'repairAgentInterventionContinuation',
  'resetMemoryExtractStatus',
  'restore',
  'settleRunningOperation',
  'settleRunningStatus',
  'softDelete',
  'softDeleteAll',
  'softDeleteByAgentId',
  'softDeleteByGroupId',
  'softDeleteByParents',
  'softDeleteBySessionId',
  'takeRunningOperation',
  'tryReserveTaskCallback',
  'update',
  'updateMetadata',
  'updateModelPin',
  'updateRunningOperationAssistantMessage',
];

describe('TopicModel - public surface', () => {
  it('exposes the same instance methods', () => {
    const model = new TopicModel({} as LobeChatDatabase, userId);
    const methods = Object.keys(model)
      .filter((key) => typeof (model as any)[key] === 'function' && !PRIVATE_MEMBERS.has(key))
      .sort();

    expect(methods).toEqual(PUBLIC_METHODS);
  });

  it('exposes the same static methods', () => {
    expect(
      [
        'claimScheduledTopic',
        'clearScheduledRun',
        'getDueScheduledTopics',
        'repointScheduledRunFailedMessage',
      ].filter((key) => typeof (TopicModel as any)[key] === 'function'),
    ).toHaveLength(4);
  });

  it('keeps the runtime exports of the module', () => {
    expect(Object.keys(topicModule).sort()).toEqual([
      'TopicModel',
      'getTopicDeviceId',
      'hasLiveTaskCallbackReservation',
    ]);
  });
});

describe('TopicModel - characterization', () => {
  const deletedAt = new Date('2024-06-01T00:00:00.000Z');

  beforeEach(async () => {
    await serverDB.delete(agentOperations);
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await serverDB.insert(sessions).values({ id: sessionId, userId });
    await serverDB.insert(agents).values({ id: agentId, userId });
    await serverDB.insert(chatGroups).values({ id: groupId, userId });
    await serverDB.insert(topics).values([
      { agentId, id: 'agent-topic', title: 'agent', userId },
      { groupId, id: 'group-topic', title: 'group', userId },
      { id: 'session-topic', sessionId, title: 'session', userId },
      { id: 'inbox-topic', title: 'inbox', userId },
      { agentId, id: 'visitor-topic', senderId: 'visitor-1', title: 'visitor', userId },
      { agentId, id: 'visitor-topic-2', senderId: 'visitor-1', title: 'visitor 2', userId },
      { id: 'foreign-topic', title: 'foreign', userId: otherUserId },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(agentOperations);
    await serverDB.delete(users);
  });

  const liveIds = async () =>
    (
      await serverDB
        .select({ id: topics.id, isDeleted: topics.isDeleted })
        .from(topics)
        .where(eq(topics.userId, userId))
    )
      .filter((row) => !row.isDeleted)
      .map((row) => row.id)
      .sort();

  describe('recycle bin', () => {
    it('softDelete trashes owned ids, skipping visitor and foreign rows', async () => {
      const result = await topicModel.softDelete(
        ['agent-topic', 'visitor-topic', 'foreign-topic'],
        { deletedAt },
      );

      expect(result.map((row) => row.id)).toEqual(['agent-topic']);
      expect(result[0]).toMatchObject({ deletedAt, isDeleted: true });
      expect(await topicModel.findById('agent-topic')).toBeUndefined();
    });

    it('softDelete returns [] for empty ids', async () => {
      expect(await topicModel.softDelete([], { deletedAt })).toEqual([]);
    });

    it.each([
      [
        'softDeleteBySessionId',
        () => topicModel.softDeleteBySessionId(sessionId, { deletedAt }),
        ['session-topic'],
      ],
      [
        'softDeleteBySessionId(null)',
        () => topicModel.softDeleteBySessionId(null, { deletedAt }),
        ['agent-topic', 'group-topic', 'inbox-topic'],
      ],
      [
        'softDeleteByGroupId',
        () => topicModel.softDeleteByGroupId(groupId, { deletedAt }),
        ['group-topic'],
      ],
      [
        'softDeleteByAgentId',
        () => topicModel.softDeleteByAgentId(agentId, { deletedAt, restrictToCreator: true }),
        ['agent-topic'],
      ],
      [
        'softDeleteByParents',
        () =>
          topicModel.softDeleteByParents(
            { groupIds: [groupId], sessionIds: [sessionId] },
            { deletedAt },
          ),
        ['group-topic', 'session-topic'],
      ],
      ['softDeleteByParents({})', () => topicModel.softDeleteByParents({}, { deletedAt }), []],
      [
        'softDeleteAll',
        () => topicModel.softDeleteAll({ deletedAt }),
        ['agent-topic', 'group-topic', 'inbox-topic', 'session-topic'],
      ],
    ] as const)('%s trashes exactly the matching creator rows', async (_name, run, expected) => {
      const result = await run();

      expect(result.map((row) => row.id).sort()).toEqual([...expected]);
    });

    it('restore / findTrashedByIds / purge only touch trashed owned rows', async () => {
      await topicModel.softDelete(['agent-topic', 'group-topic'], { deletedAt });

      expect(
        (await topicModel.findTrashedByIds(['agent-topic', 'inbox-topic'])).map((r) => r.id),
      ).toEqual(['agent-topic']);
      expect((await topicModel.restore(['agent-topic', 'inbox-topic'])).map((r) => r.id)).toEqual([
        'agent-topic',
      ]);
      expect(await topicModel.purge(['agent-topic', 'group-topic', 'inbox-topic'])).toEqual([
        'group-topic',
      ]);
      expect(await liveIds()).toEqual([
        'agent-topic',
        'inbox-topic',
        'session-topic',
        'visitor-topic',
        'visitor-topic-2',
      ]);
      expect(await topicModel.restore([])).toEqual([]);
      expect(await topicModel.findTrashedByIds([])).toEqual([]);
      expect(await topicModel.purge([])).toEqual([]);
    });

    it('keeps subagent threads while trashed and purges them with the topic', async () => {
      await serverDB.insert(threads).values({
        id: 'subagent-thread',
        metadata: { sourceToolCallId: 'toolu_1' },
        topicId: 'agent-topic',
        type: ThreadType.Isolation,
        userId,
      });
      await serverDB.insert(messages).values({
        id: 'subagent-message',
        role: 'assistant',
        threadId: 'subagent-thread',
        topicId: 'agent-topic',
        userId,
      });
      const threadIds = async () =>
        (await serverDB.select({ id: threads.id }).from(threads)).map((row) => row.id);
      const messageIds = async () =>
        (await serverDB.select({ id: messages.id }).from(messages)).map((row) => row.id);

      await topicModel.softDelete(['agent-topic'], { deletedAt });
      expect(await threadIds()).toEqual(['subagent-thread']);
      expect(await messageIds()).toEqual(['subagent-message']);

      expect(await topicModel.purge(['agent-topic'])).toEqual(['agent-topic']);
      expect(await threadIds()).toEqual([]);
      expect(await messageIds()).toEqual([]);
    });

    it('batchDeleteIncludingTrashed removes trashed rows too', async () => {
      await topicModel.softDelete(['agent-topic'], { deletedAt });
      await topicModel.batchDeleteIncludingTrashed(['agent-topic', 'visitor-topic']);

      const remaining = await serverDB.select({ id: topics.id }).from(topics);
      expect(remaining.map((row) => row.id)).not.toContain('agent-topic');
      expect(remaining.map((row) => row.id)).toContain('visitor-topic');
    });
  });

  describe('reads', () => {
    it('findOwnersByIds returns owned, non-visitor rows', async () => {
      expect(await topicModel.findOwnersByIds([])).toEqual([]);
      expect(
        await topicModel.findOwnersByIds(['agent-topic', 'visitor-topic', 'foreign-topic']),
      ).toEqual([{ id: 'agent-topic', userId }]);
    });

    it('share visitor scoping depends on includeShareVisitor', async () => {
      const visitorModel = new TopicModel(serverDB, userId, undefined, undefined, {
        includeShareVisitor: true,
      });

      expect(await topicModel.findById('visitor-topic')).toBeUndefined();
      expect((await visitorModel.findById('visitor-topic'))?.id).toBe('visitor-topic');
      expect(await topicModel.findShareVisitorTopicIds(['visitor-topic', 'agent-topic'])).toEqual([
        'visitor-topic',
      ]);
      expect(await topicModel.countBySender({ agentId, senderId: 'visitor-1' })).toBe(2);
      expect(await topicModel.countBySender({ agentId, senderId: 'visitor-2' })).toBe(0);
      expect(await topicModel.countShareVisitors({ agentId })).toEqual({
        topicCount: 2,
        visitorCount: 1,
      });
    });

    it('findRecentByBotThread matches the bot thread id, newest first, limited', async () => {
      await serverDB.insert(topics).values([
        {
          id: 'bot-1',
          metadata: { bot: { platformThreadId: 'thread-1' } } as any,
          updatedAt: new Date('2024-01-01'),
          userId,
        },
        {
          id: 'bot-2',
          metadata: { bot: { platformThreadId: 'thread-1' } } as any,
          updatedAt: new Date('2024-01-02'),
          userId,
        },
        {
          id: 'bot-other',
          metadata: { bot: { platformThreadId: 'thread-2' } } as any,
          userId,
        },
      ]);

      expect(await topicModel.findRecentByBotThread('')).toEqual([]);
      expect((await topicModel.findRecentByBotThread('thread-1')).map((t) => t.id)).toEqual([
        'bot-2',
        'bot-1',
      ]);
      expect(
        (await topicModel.findRecentByBotThread('thread-1', { limit: 1 })).map((t) => t.id),
      ).toEqual(['bot-2']);
    });
  });

  describe('running operation markers', () => {
    const setRunning = (metadata: Record<string, unknown>) =>
      serverDB
        .update(topics)
        .set({ metadata: metadata as any })
        .where(eq(topics.id, 'agent-topic'));

    it('removeRunningOperationChild drops only the named child', async () => {
      expect(await topicModel.removeRunningOperationChild('agent-topic', 'child-1')).toBe(false);

      await setRunning({
        runningOperation: {
          assistantMessageId: 'msg',
          childOperations: [
            { assistantMessageId: 'c1', operationId: 'child-1' },
            { assistantMessageId: 'c2', operationId: 'child-2' },
          ],
          operationId: 'root',
        },
      });

      expect(await topicModel.removeRunningOperationChild('agent-topic', 'child-1')).toBe(true);
      const topic = await topicModel.findById('agent-topic');
      expect(topic?.metadata?.runningOperation?.childOperations).toEqual([
        { assistantMessageId: 'c2', operationId: 'child-2' },
      ]);
    });

    it.each([
      ['no row, fresh marker stamp', undefined, new Date().toISOString(), true],
      ['no row, stale marker stamp', undefined, '2000-01-01T00:00:00.000Z', false],
      ['no row, no stamp', undefined, undefined, false],
      ['parked on a human', 'waiting_for_human', undefined, true],
      ['terminal status', 'done', undefined, false],
      ['fresh running row', 'running', undefined, true],
    ] as const)(
      'isRunningOperationAlive: %s',
      async (_name, operationStatus, startedAt, expected) => {
        if (operationStatus) {
          await serverDB.insert(agentOperations).values({
            id: 'op-alive',
            status: operationStatus,
            topicId: 'agent-topic',
            userId,
          } as any);
        }

        expect(
          await topicModel.isRunningOperationAlive(serverDB, {
            assistantMessageId: 'msg',
            operationId: 'op-alive',
            startedAt,
          } as any),
        ).toBe(expected);
      },
    );
  });
});
