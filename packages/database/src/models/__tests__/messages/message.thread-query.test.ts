import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messages, sessions, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'thread-query-test-user';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.insert(users).values([{ id: userId }]);
  });
});

afterEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
  });
});

describe('MessageModel thread query', () => {
  describe('query with threadId - complete thread data', () => {
    it('should return parent messages + thread messages for Continuation type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread with Continuation type
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg2',
            type: 'continuation',
          },
        ]);

        // Create main conversation messages (parent messages)
        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second message - source',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third message - after source',
            createdAt: new Date('2023-01-03'),
          },
          // Thread messages
          {
            id: 'thread-msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message 1',
            createdAt: new Date('2023-01-02T10:00:00'),
          },
          {
            id: 'thread-msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'assistant',
            content: 'thread message 2',
            createdAt: new Date('2023-01-02T11:00:00'),
          },
        ]);
      });

      const result = await messageModel.query({ threadId: 'thread1' });

      // Should include parent messages (msg1, msg2) + thread messages (thread-msg1, thread-msg2)
      // Should NOT include msg3 (after source message)
      expect(result).toHaveLength(4);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2', 'thread-msg1', 'thread-msg2']);
    });

    it('should return parent messages + thread messages when querying with agentId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'agent1', userId }]);
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread with Continuation type
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg2',
            type: 'continuation',
          },
        ]);

        // Create main conversation messages (parent messages) with agentId
        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second message - source',
            createdAt: new Date('2023-01-02'),
          },
          // Thread messages
          {
            id: 'thread-msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message 1',
            createdAt: new Date('2023-01-02T10:00:00'),
          },
          {
            id: 'thread-msg2',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'assistant',
            content: 'thread message 2',
            createdAt: new Date('2023-01-02T11:00:00'),
          },
        ]);
      });

      // Query with both agentId and threadId
      const result = await messageModel.query({ agentId: 'agent1', threadId: 'thread1' });

      // Should include parent messages (msg1, msg2) + thread messages (thread-msg1, thread-msg2)
      expect(result).toHaveLength(4);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2', 'thread-msg1', 'thread-msg2']);
    });

    it('should return parent messages + thread messages when querying with topicId and threadId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'agent1', userId }]);
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([
          { id: 'topic1', sessionId: 'session1', userId },
          { id: 'topic2', sessionId: 'session1', userId },
        ]);

        // Create thread with Continuation type
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg2',
            type: 'continuation',
          },
        ]);

        // Create messages in topic1
        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'topic1 first message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'topic1 second message - source',
            createdAt: new Date('2023-01-02'),
          },
          // Thread messages in topic1
          {
            id: 'thread-msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message 1',
            createdAt: new Date('2023-01-02T10:00:00'),
          },
          // Messages in topic2 (should not be included)
          {
            id: 'topic2-msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic2',
            threadId: null,
            role: 'user',
            content: 'topic2 message',
            createdAt: new Date('2023-01-01T05:00:00'),
          },
        ]);
      });

      // Query with agentId, topicId and threadId
      const result = await messageModel.query({
        agentId: 'agent1',
        topicId: 'topic1',
        threadId: 'thread1',
      });

      // Should include parent messages (msg1, msg2) + thread message (thread-msg1)
      // Should NOT include topic2-msg1
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2', 'thread-msg1']);
    });

    it('should return only source message + thread messages for Standalone type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread with Standalone type
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg2',
            type: 'standalone',
          },
        ]);

        // Create main conversation messages
        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second message - source',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third message',
            createdAt: new Date('2023-01-03'),
          },
          // Thread messages
          {
            id: 'thread-msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message 1',
            createdAt: new Date('2023-01-02T10:00:00'),
          },
          {
            id: 'thread-msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'assistant',
            content: 'thread message 2',
            createdAt: new Date('2023-01-02T11:00:00'),
          },
        ]);
      });

      const result = await messageModel.query({ threadId: 'thread1' });

      // For Standalone: should include only source message (msg2) + thread messages
      // Should NOT include msg1 or msg3
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['msg2', 'thread-msg1', 'thread-msg2']);
    });

    it('should return only thread messages for Isolation type (no parent messages)', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'agent1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', userId }]);

        // Create thread with Isolation type
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg2',
            type: 'isolation',
          },
        ]);

        // Create main conversation messages
        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second message - source',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third message',
            createdAt: new Date('2023-01-03'),
          },
          // Thread messages
          {
            id: 'thread-msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message 1',
            createdAt: new Date('2023-01-02T10:00:00'),
          },
          {
            id: 'thread-msg2',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'assistant',
            content: 'thread message 2',
            createdAt: new Date('2023-01-02T11:00:00'),
          },
        ]);
      });

      const result = await messageModel.query({
        agentId: 'agent1',
        topicId: 'topic1',
        threadId: 'thread1',
      });

      // For Isolation: should include ONLY thread messages, NO parent messages at all
      // Should NOT include msg1, msg2 (source), or msg3
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['thread-msg1', 'thread-msg2']);
    });

    it('should return only thread messages when thread has no sourceMessageId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread without sourceMessageId
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: null,
            type: 'continuation',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'main message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'thread-msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message',
            createdAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await messageModel.query({ threadId: 'thread1' });

      // Should only return thread messages (fallback to original behavior)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-msg1');
    });

    it('should handle messages in correct chronological order', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg2',
            type: 'continuation',
          },
        ]);

        // Insert messages in non-chronological order
        await trx.insert(messages).values([
          {
            id: 'thread-msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'assistant',
            content: 'thread message 2',
            createdAt: new Date('2023-01-02T11:00:00'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'source message',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'thread-msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread message 1',
            createdAt: new Date('2023-01-02T10:00:00'),
          },
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first message',
            createdAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await messageModel.query({ threadId: 'thread1' });

      // Should be in chronological order: msg1 -> msg2 -> thread-msg1 -> thread-msg2
      expect(result).toHaveLength(4);
      expect(result[0].id).toBe('msg1');
      expect(result[1].id).toBe('msg2');
      expect(result[2].id).toBe('thread-msg1');
      expect(result[3].id).toBe('thread-msg2');
    });

    it('should exclude messages from other threads', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create two threads
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg1',
            type: 'continuation',
          },
          {
            id: 'thread2',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg1',
            type: 'continuation',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'source message',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'thread1-msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'thread 1 message',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'thread2-msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread2',
            role: 'user',
            content: 'thread 2 message',
            createdAt: new Date('2023-01-02T01:00:00'),
          },
        ]);
      });

      const result = await messageModel.query({ threadId: 'thread1' });

      // Should include parent (msg1) + thread1 messages only
      // Should NOT include thread2 messages
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'thread1-msg1']);
    });
  });

  describe('getThreadParentMessages', () => {
    it('should return only source message for Standalone thread type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second - source',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg2',
        topicId: 'topic1',
        threadType: 'standalone' as any,
      });

      // Standalone should only return the source message
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg2');
    });

    it('should return empty array for Isolation thread type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'agent1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', userId }]);

        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second - source',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            agentId: 'agent1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg2',
        topicId: 'topic1',
        threadType: 'isolation' as any,
      });

      // Isolation should return empty array (no parent messages)
      expect(result).toHaveLength(0);
    });

    it('should return all messages up to source message for Continuation thread type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second - source',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third - after source',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg2',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      // Continuation should return msg1 and msg2 (up to and including source)
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg1');
      expect(result[1].id).toBe('msg2');
    });

    it('should exclude messages from other threads in Continuation mode', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread first due to foreign key constraint
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'msg3',
            type: 'continuation',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg1',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'first',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg-in-thread',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'message in thread',
            createdAt: new Date('2023-01-02T12:00:00'), // Same day but in thread
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third - source',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg3',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      // Should include msg1, msg2, msg3
      // Should NOT include msg-in-thread (belongs to another thread)
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2', 'msg3']);
    });

    it('should return empty array when source message not found', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'non-existent',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      expect(result).toHaveLength(0);
    });

    it('should include source message even with microsecond timestamp precision difference', async () => {
      // This test simulates the production scenario where:
      // - PostgreSQL timestamptz has microsecond precision (e.g., 06:56:15.804448)
      // - JavaScript Date only has millisecond precision (e.g., 06:56:15.804)
      // When Drizzle reads the timestamp, microseconds are truncated, causing lte comparison to fail
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Insert messages with raw SQL to set microsecond-precision timestamps
        // msg1: 06:56:15.074286 (earlier)
        // msg2: 06:56:15.804448 (source message with microseconds)
        await trx.execute(sql`
          INSERT INTO messages (id, user_id, session_id, topic_id, thread_id, role, content, created_at)
          VALUES
            ('msg1', ${userId}, 'session1', 'topic1', NULL, 'user', 'first message', '2023-01-01 06:56:15.074286+00'),
            ('msg2', ${userId}, 'session1', 'topic1', NULL, 'assistant', 'source message', '2023-01-01 06:56:15.804448+00')
        `);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg2',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      // Should include BOTH messages, including source message (msg2)
      // This tests the fix for microsecond precision issue
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2']);
    });
  });
});
