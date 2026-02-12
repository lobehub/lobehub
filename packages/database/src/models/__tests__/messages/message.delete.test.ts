import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  agentsToSessions,
  chatGroups,
  messagePlugins,
  messageQueries,
  messages,
  messageTranslates,
  messageTTS,
  sessions,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-delete-test';
const otherUserId = 'message-delete-test-other';
const messageModel = new MessageModel(serverDB, userId);
const embeddingsId = uuid();

beforeEach(async () => {
  // Clear tables before each test case
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);

    await trx.insert(sessions).values([{ id: '1', userId }]);
  });
});

afterEach(async () => {
  // Clear tables after each test case
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel Delete Tests', () => {
  describe('deleteMessage', () => {
    it('should delete a message', async () => {
      // Create test data
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId, role: 'user', content: 'message 1' }]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessage('1');

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(0);
    });

    it('should delete a message with tool calls', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values([
          { id: '1', userId, role: 'user', content: 'message 1', tools: [{ id: 'tool1' }] },
          { id: '2', userId, role: 'tool', content: 'message 1' },
        ]);
        await trx
          .insert(messagePlugins)
          .values([{ id: '2', toolCallId: 'tool1', identifier: 'plugin-1', userId }]);
      });

      // 调用 deleteMessage 方法
      await messageModel.deleteMessage('1');

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(0);

      const result2 = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, '2'));

      expect(result2).toHaveLength(0);
    });

    it('should only delete messages belonging to the user', async () => {
      // Create test data
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId: otherUserId, role: 'user', content: 'message 1' }]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessage('1');

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(1);
    });

    it('should update child messages parentId to deleted message parentId', async () => {
      // Create a tree structure: A -> B -> C
      // When B is deleted, C should have parentId = A
      await serverDB.insert(messages).values([
        { id: 'A', userId, role: 'user', content: 'message A', parentId: null },
        { id: 'B', userId, role: 'assistant', content: 'message B', parentId: 'A' },
        { id: 'C', userId, role: 'user', content: 'message C', parentId: 'B' },
      ]);

      // Delete message B
      await messageModel.deleteMessage('B');

      // Assert B is deleted
      const deletedMessage = await serverDB.select().from(messages).where(eq(messages.id, 'B'));
      expect(deletedMessage).toHaveLength(0);

      // Assert C's parentId is now A (inherited from B's parentId)
      const messageC = await serverDB.select().from(messages).where(eq(messages.id, 'C'));
      expect(messageC).toHaveLength(1);
      expect(messageC[0].parentId).toBe('A');

      // Assert A still exists and is unchanged
      const messageA = await serverDB.select().from(messages).where(eq(messages.id, 'A'));
      expect(messageA).toHaveLength(1);
      expect(messageA[0].parentId).toBeNull();
    });

    it('should set child messages parentId to null when deleting root message', async () => {
      // Create a tree structure: A (root) -> B, C
      // When A is deleted, B and C should have parentId = null
      await serverDB.insert(messages).values([
        { id: 'A', userId, role: 'user', content: 'message A', parentId: null },
        { id: 'B', userId, role: 'assistant', content: 'message B', parentId: 'A' },
        { id: 'C', userId, role: 'user', content: 'message C', parentId: 'A' },
      ]);

      // Delete root message A
      await messageModel.deleteMessage('A');

      // Assert A is deleted
      const deletedMessage = await serverDB.select().from(messages).where(eq(messages.id, 'A'));
      expect(deletedMessage).toHaveLength(0);

      // Assert B's parentId is now null
      const messageB = await serverDB.select().from(messages).where(eq(messages.id, 'B'));
      expect(messageB).toHaveLength(1);
      expect(messageB[0].parentId).toBeNull();

      // Assert C's parentId is now null
      const messageC = await serverDB.select().from(messages).where(eq(messages.id, 'C'));
      expect(messageC).toHaveLength(1);
      expect(messageC[0].parentId).toBeNull();
    });

    it('should only update child messages belonging to the same user', async () => {
      // Create messages where child belongs to different user
      await serverDB.insert(messages).values([
        { id: 'A', userId, role: 'user', content: 'message A', parentId: null },
        { id: 'B', userId, role: 'assistant', content: 'message B', parentId: 'A' },
        { id: 'C', userId: otherUserId, role: 'user', content: 'message C', parentId: 'B' },
      ]);

      // Delete message B
      await messageModel.deleteMessage('B');

      // Assert B is deleted
      const deletedMessage = await serverDB.select().from(messages).where(eq(messages.id, 'B'));
      expect(deletedMessage).toHaveLength(0);

      // Assert C's parentId is NOT updated (belongs to other user)
      // Due to foreign key constraint with onDelete: 'set null', it will be set to null by DB
      const messageC = await serverDB.select().from(messages).where(eq(messages.id, 'C'));
      expect(messageC).toHaveLength(1);
      expect(messageC[0].parentId).toBeNull();
    });
  });

  describe('deleteMessages', () => {
    it('should delete 2 messages', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
      ]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessages(['1', '2']);

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(0);
      const result2 = await serverDB.select().from(messages).where(eq(messages.id, '2'));
      expect(result2).toHaveLength(0);
    });

    it('should only delete messages belonging to the user', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId: otherUserId, role: 'user', content: 'message 1' },
        { id: '2', userId: otherUserId, role: 'user', content: 'message 1' },
      ]);

      // 调用 deleteMessage 方法
      await messageModel.deleteMessages(['1', '2']);

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.id, '1'));
      expect(result).toHaveLength(1);
    });

    it('should update child messages parentId when deleting parent chain', async () => {
      // Create a tree: A -> B -> C -> D
      // Delete [B, C], D should have parentId = A
      await serverDB.insert(messages).values([
        { id: 'A', userId, role: 'user', content: 'message A', parentId: null },
        { id: 'B', userId, role: 'assistant', content: 'message B', parentId: 'A' },
        { id: 'C', userId, role: 'tool', content: 'message C', parentId: 'B' },
        { id: 'D', userId, role: 'user', content: 'message D', parentId: 'C' },
      ]);

      // Delete B and C
      await messageModel.deleteMessages(['B', 'C']);

      // Assert B and C are deleted
      const deletedB = await serverDB.select().from(messages).where(eq(messages.id, 'B'));
      expect(deletedB).toHaveLength(0);
      const deletedC = await serverDB.select().from(messages).where(eq(messages.id, 'C'));
      expect(deletedC).toHaveLength(0);

      // Assert D's parentId is now A (skipping deleted B and C)
      const messageD = await serverDB.select().from(messages).where(eq(messages.id, 'D'));
      expect(messageD).toHaveLength(1);
      expect(messageD[0].parentId).toBe('A');

      // Assert A is unchanged
      const messageA = await serverDB.select().from(messages).where(eq(messages.id, 'A'));
      expect(messageA).toHaveLength(1);
      expect(messageA[0].parentId).toBeNull();
    });

    it('should set child parentId to null when deleting entire parent chain from root', async () => {
      // Create a tree: A -> B -> C -> D
      // Delete [A, B, C], D should have parentId = null
      await serverDB.insert(messages).values([
        { id: 'A', userId, role: 'user', content: 'message A', parentId: null },
        { id: 'B', userId, role: 'assistant', content: 'message B', parentId: 'A' },
        { id: 'C', userId, role: 'tool', content: 'message C', parentId: 'B' },
        { id: 'D', userId, role: 'user', content: 'message D', parentId: 'C' },
      ]);

      // Delete A, B, and C
      await messageModel.deleteMessages(['A', 'B', 'C']);

      // Assert A, B, C are deleted
      const remaining = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('D');

      // Assert D's parentId is null (all ancestors deleted)
      expect(remaining[0].parentId).toBeNull();
    });

    it('should handle multiple independent trees when batch deleting', async () => {
      // Create two independent trees:
      // Tree 1: A -> B -> C
      // Tree 2: X -> Y -> Z
      // Delete [B, Y], C should have parentId = A, Z should have parentId = X
      await serverDB.insert(messages).values([
        { id: 'A', userId, role: 'user', content: 'message A', parentId: null },
        { id: 'B', userId, role: 'assistant', content: 'message B', parentId: 'A' },
        { id: 'C', userId, role: 'user', content: 'message C', parentId: 'B' },
        { id: 'X', userId, role: 'user', content: 'message X', parentId: null },
        { id: 'Y', userId, role: 'assistant', content: 'message Y', parentId: 'X' },
        { id: 'Z', userId, role: 'user', content: 'message Z', parentId: 'Y' },
      ]);

      // Delete B and Y
      await messageModel.deleteMessages(['B', 'Y']);

      // Assert C's parentId is A
      const messageC = await serverDB.select().from(messages).where(eq(messages.id, 'C'));
      expect(messageC).toHaveLength(1);
      expect(messageC[0].parentId).toBe('A');

      // Assert Z's parentId is X
      const messageZ = await serverDB.select().from(messages).where(eq(messages.id, 'Z'));
      expect(messageZ).toHaveLength(1);
      expect(messageZ[0].parentId).toBe('X');
    });

    it('should handle empty ids array', async () => {
      await serverDB
        .insert(messages)
        .values([{ id: 'A', userId, role: 'user', content: 'message A' }]);

      // Should not throw and not delete anything
      await messageModel.deleteMessages([]);

      const result = await serverDB.select().from(messages).where(eq(messages.id, 'A'));
      expect(result).toHaveLength(1);
    });
  });
  describe('deleteMessageTranslate', () => {
    it('should delete the message translate record', async () => {
      // Create test data
      await serverDB.insert(messages).values([{ id: '1', role: 'abc', userId }]);
      await serverDB.insert(messageTranslates).values([{ id: '1', userId }]);

      // 调用 deleteMessageTranslate 方法
      await messageModel.deleteMessageTranslate('1');

      // Assert result
      const result = await serverDB
        .select()
        .from(messageTranslates)
        .where(eq(messageTranslates.id, '1'));

      expect(result).toHaveLength(0);
    });
  });

  describe('deleteMessageTTS', () => {
    it('should delete the message TTS record', async () => {
      // Create test data
      await serverDB.insert(messages).values([{ id: '1', role: 'abc', userId }]);
      await serverDB.insert(messageTTS).values([{ userId, id: '1' }]);

      // 调用 deleteMessageTTS 方法
      await messageModel.deleteMessageTTS('1');

      // Assert result
      const result = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, '1'));
      expect(result).toHaveLength(0);
    });
  });
  describe('deleteMessagesBySession', () => {
    it('should delete messages by session ID', async () => {
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          sessionId: 'session1',
          role: 'user',
          content: 'message 1',
        },
        {
          id: '2',
          userId,
          sessionId: 'session1',
          role: 'assistant',
          content: 'message 2',
        },
        {
          id: '3',
          userId,
          sessionId: 'session2',
          role: 'user',
          content: 'message 3',
        },
      ]);

      await messageModel.deleteMessagesBySession('session1');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));

      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].id).toBe('3');
    });

    it('should delete messages by session ID and topic ID', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          role: 'user',
          content: 'message 1',
        },
        {
          id: '2',
          userId,
          sessionId: 'session1',
          topicId: 'topic2',
          role: 'assistant',
          content: 'message 2',
        },
      ]);

      await messageModel.deleteMessagesBySession('session1', 'topic1');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));

      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].id).toBe('2');
    });

    it('should delete only non-topic messages when topicId is null', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          sessionId: 'session1',
          topicId: null,
          role: 'user',
          content: 'message without topic 1',
        },
        {
          id: '2',
          userId,
          sessionId: 'session1',
          topicId: null,
          role: 'assistant',
          content: 'message without topic 2',
        },
        {
          id: '3',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          role: 'user',
          content: 'message in topic1',
        },
        {
          id: '4',
          userId,
          sessionId: 'session1',
          topicId: 'topic2',
          role: 'assistant',
          content: 'message in topic2',
        },
      ]);

      // Delete messages in session1 with null topicId
      await messageModel.deleteMessagesBySession('session1', null);

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId))
        .orderBy(messages.id);

      // Should only keep messages with topics
      expect(remainingMessages).toHaveLength(2);
      expect(remainingMessages[0].id).toBe('3');
      expect(remainingMessages[1].id).toBe('4');
    });

    it('should delete messages with specific groupId in session', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(chatGroups).values([
        { id: 'group1', userId, title: 'Group 1' },
        { id: 'group2', userId, title: 'Group 2' },
      ]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-group1',
          userId,
          sessionId: 'session1',
          groupId: 'group1',
          role: 'user',
          content: 'message in group1',
        },
        {
          id: 'msg-group2',
          userId,
          sessionId: 'session1',
          groupId: 'group2',
          role: 'assistant',
          content: 'message in group2',
        },
        {
          id: 'msg-no-group',
          userId,
          sessionId: 'session1',
          groupId: null,
          role: 'user',
          content: 'message without group',
        },
      ]);

      // Delete messages with specific groupId
      await messageModel.deleteMessagesBySession('session1', null, 'group1');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId))
        .orderBy(messages.id);

      expect(remainingMessages).toHaveLength(2);
      expect(remainingMessages[0].id).toBe('msg-group2');
      expect(remainingMessages[1].id).toBe('msg-no-group');
    });

    it('should delete messages with combined topicId and groupId filters', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);
      await serverDB.insert(chatGroups).values([{ id: 'group1', userId, title: 'Group 1' }]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-t1-g1',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          groupId: 'group1',
          role: 'user',
          content: 'topic1 group1',
        },
        {
          id: 'msg-t1-no-group',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          groupId: null,
          role: 'user',
          content: 'topic1 no group',
        },
        {
          id: 'msg-no-topic-g1',
          userId,
          sessionId: 'session1',
          topicId: null,
          groupId: 'group1',
          role: 'user',
          content: 'no topic group1',
        },
      ]);

      // Delete messages with specific topic and group combination
      await messageModel.deleteMessagesBySession('session1', 'topic1', 'group1');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId))
        .orderBy(messages.id);

      expect(remainingMessages).toHaveLength(2);
      expect(remainingMessages[0].id).toBe('msg-no-topic-g1');
      expect(remainingMessages[1].id).toBe('msg-t1-no-group');
    });
  });
  describe('deleteMessageQuery', () => {
    it('should delete a message query by ID', async () => {
      // Create test data
      const queryId = uuid();
      await serverDB.insert(messages).values({
        id: 'msg4',
        userId,
        role: 'user',
        content: 'test message',
      });

      await serverDB.insert(messageQueries).values({
        id: queryId,
        messageId: 'msg4',
        userQuery: 'test query',
        rewriteQuery: 'rewritten query',
        userId,
      });

      // 验证查询已创建
      const beforeDelete = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryId));

      expect(beforeDelete).toHaveLength(1);

      // 调用 deleteMessageQuery 方法
      await messageModel.deleteMessageQuery(queryId);

      // 验证查询已删除
      const afterDelete = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryId));

      expect(afterDelete).toHaveLength(0);
    });

    it('should only delete message queries belonging to the user', async () => {
      // Create test data - 其他用户的查询
      const queryId = uuid();
      await serverDB.insert(messages).values({
        id: 'msg5',
        userId: otherUserId,
        role: 'user',
        content: 'test message',
      });

      await serverDB.insert(messageQueries).values({
        id: queryId,
        messageId: 'msg5',
        userQuery: 'test query',
        rewriteQuery: 'rewritten query',
        userId: otherUserId, // 其他用户
      });

      // 调用 deleteMessageQuery 方法
      await messageModel.deleteMessageQuery(queryId);

      // 验证查询未被删除
      const afterDelete = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryId));

      expect(afterDelete).toHaveLength(1);
    });

    it('should throw error when deleting non-existent message query', async () => {
      // 调用 deleteMessageQuery 方法删除不存在的查询
      try {
        await messageModel.deleteMessageQuery('non-existent-id');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe('batchDeleteByAgentId', () => {
    it('should delete messages with direct agentId match', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'agent-del-1', userId, title: 'Agent Delete 1' }]);

        await trx.insert(messages).values([
          {
            id: 'msg-del-1',
            userId,
            agentId: 'agent-del-1',
            role: 'user',
            content: 'to delete',
          },
          {
            id: 'msg-keep-1',
            userId,
            agentId: null,
            role: 'user',
            content: 'to keep',
          },
        ]);
      });

      await messageModel.batchDeleteByAgentId('agent-del-1');

      const remaining = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('msg-keep-1');
    });

    it('should delete legacy messages by agentId through agentsToSessions lookup', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session-del', userId }]);

        await trx.insert(agents).values([{ id: 'agent-del-2', userId, title: 'Agent Delete 2' }]);

        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'agent-del-2', sessionId: 'session-del', userId }]);

        await trx.insert(messages).values([
          {
            id: 'msg-del-legacy',
            userId,
            sessionId: 'session-del',
            agentId: null,
            role: 'user',
            content: 'legacy to delete',
          },
          {
            id: 'msg-keep-2',
            userId,
            sessionId: null,
            agentId: null,
            role: 'user',
            content: 'to keep',
          },
        ]);
      });

      await messageModel.batchDeleteByAgentId('agent-del-2');

      const remaining = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('msg-keep-2');
    });

    it('should delete both legacy and new messages using OR condition', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session-del-mixed', userId }]);

        await trx
          .insert(agents)
          .values([{ id: 'agent-del-mixed', userId, title: 'Agent Delete Mixed' }]);

        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'agent-del-mixed', sessionId: 'session-del-mixed', userId }]);

        await trx.insert(messages).values([
          {
            id: 'msg-del-legacy-mixed',
            userId,
            sessionId: 'session-del-mixed',
            agentId: null,
            role: 'user',
            content: 'legacy to delete',
          },
          {
            id: 'msg-del-new-mixed',
            userId,
            sessionId: null,
            agentId: 'agent-del-mixed',
            role: 'user',
            content: 'new to delete',
          },
          {
            id: 'msg-keep-mixed',
            userId,
            sessionId: null,
            agentId: null,
            role: 'user',
            content: 'to keep',
          },
        ]);
      });

      await messageModel.batchDeleteByAgentId('agent-del-mixed');

      const remaining = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('msg-keep-mixed');
    });

    it('should only delete messages belonging to the current user', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([
          { id: 'agent-del-user', userId, title: 'Agent Delete User' },
          { id: 'agent-del-other', userId: otherUserId, title: 'Agent Delete Other' },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg-del-user',
            userId,
            agentId: 'agent-del-user',
            role: 'user',
            content: 'user to delete',
          },
          {
            id: 'msg-keep-other',
            userId: otherUserId,
            agentId: 'agent-del-other',
            role: 'user',
            content: 'other user keep',
          },
        ]);
      });

      await messageModel.batchDeleteByAgentId('agent-del-user');

      // User's message should be deleted
      const userMessages = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });
      expect(userMessages).toHaveLength(0);

      // Other user's message should remain
      const otherMessages = await serverDB.query.messages.findMany({
        where: eq(messages.userId, otherUserId),
      });
      expect(otherMessages).toHaveLength(1);
      expect(otherMessages[0].id).toBe('msg-keep-other');
    });

    it('should do nothing when agentId has no associated messages', async () => {
      await serverDB
        .insert(agents)
        .values([{ id: 'agent-del-empty', userId, title: 'Agent Delete Empty' }]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-keep-empty',
          userId,
          agentId: null,
          role: 'user',
          content: 'keep this',
        },
      ]);

      await messageModel.batchDeleteByAgentId('agent-del-empty');

      const remaining = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('msg-keep-empty');
    });
  });
});
