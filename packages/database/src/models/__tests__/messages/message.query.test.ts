import { INBOX_SESSION_ID } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  agentsToSessions,
  chatGroups,
  chunks,
  documents,
  embeddings,
  fileChunks,
  files,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTranslates,
  messageTTS,
  sessions,
  threads,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { codeEmbedding } from '../fixtures/embedding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-query-test';
const otherUserId = 'message-query-test-other';
const messageModel = new MessageModel(serverDB, userId);
const embeddingsId = uuid();

beforeEach(async () => {
  // Clear tables before each test case
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);

    await trx.insert(sessions).values([
      // { id: 'session1', userId },
      // { id: 'session2', userId },
      { id: '1', userId },
    ]);
    await trx.insert(files).values({
      id: 'f1',
      userId: userId,
      url: 'abc',
      name: 'file-1',
      fileType: 'image/png',
      size: 1000,
    });

    await trx.insert(embeddings).values({
      id: embeddingsId,
      embeddings: codeEmbedding,
      userId,
    });
  });
});

afterEach(async () => {
  // Clear tables after each test case
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel Query Tests', () => {
  describe('query', () => {
    it('should query messages by user ID', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1', createdAt: new Date('2023-01-01') },
        { id: '2', userId, role: 'user', content: 'message 2', createdAt: new Date('2023-02-01') },
        {
          id: '3',
          userId: otherUserId,
          role: 'user',
          content: 'message 3',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      // Call query method
      const result = await messageModel.query();

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should return empty messages if not match the user ID', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId: otherUserId,
          role: 'user',
          content: '1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId: otherUserId,
          role: 'user',
          content: '2',
          createdAt: new Date('2023-02-01'),
        },
        {
          id: '3',
          userId: otherUserId,
          role: 'user',
          content: '3',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      // Call query method
      const result = await messageModel.query();

      // Assert result
      expect(result).toHaveLength(0);
    });

    it('should query messages with pagination', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1', createdAt: new Date('2023-01-01') },
        { id: '2', userId, role: 'user', content: 'message 2', createdAt: new Date('2023-02-01') },
        { id: '3', userId, role: 'user', content: 'message 3', createdAt: new Date('2023-03-01') },
      ]);

      // Test pagination
      const result1 = await messageModel.query({ current: 0, pageSize: 2 });
      expect(result1).toHaveLength(2);

      const result2 = await messageModel.query({ current: 1, pageSize: 1 });
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('2');
    });

    it('should filter messages by sessionId', async () => {
      // Create test data
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          sessionId: 'session1',
          content: 'message 1',
          createdAt: new Date('2022-02-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          sessionId: 'session1',
          content: 'message 2',
          createdAt: new Date('2023-02-02'),
        },
        { id: '3', userId, role: 'user', sessionId: 'session2', content: 'message 3' },
      ]);

      // Test filtering by sessionId
      const result = await messageModel.query({ sessionId: 'session1' });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should filter messages by topicId', async () => {
      // Create test data
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([{ id: sessionId, userId }]);
      const topicId = 'topic1';
      await serverDB.insert(topics).values([
        { id: topicId, sessionId, userId },
        { id: 'topic2', sessionId, userId },
      ]);

      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', topicId, content: '1', createdAt: new Date('2022-04-01') },
        { id: '2', userId, role: 'user', topicId, content: '2', createdAt: new Date('2023-02-01') },
        { id: '3', userId, role: 'user', topicId: 'topic2', content: 'message 3' },
      ]);

      // Test filtering by topicId
      const result = await messageModel.query({ topicId });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should filter messages by groupId and expose group metadata', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([
          { id: 'group-1', userId, title: 'Group 1' },
          { id: 'group-2', userId, title: 'Group 2' },
        ]);

        await trx.insert(agents).values([
          { id: 'agent-group', userId, title: 'Agent Group' },
          { id: 'agent-other', userId, title: 'Agent Other' },
        ]);

        await trx.insert(messages).values([
          {
            id: 'group-message',
            userId,
            role: 'assistant',
            content: 'group message',
            groupId: 'group-1',
            agentId: 'agent-group',
            targetId: 'user',
            createdAt: new Date('2024-01-01'),
          },
          {
            id: 'other-message',
            userId,
            role: 'assistant',
            content: 'other group message',
            groupId: 'group-2',
            agentId: 'agent-other',
            targetId: 'user',
            createdAt: new Date('2024-01-02'),
          },
        ]);
      });

      const result = await messageModel.query({ groupId: 'group-1' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('group-message');
      expect(result[0].groupId).toBe('group-1');
      expect(result[0].agentId).toBe('agent-group');
      expect(result[0].targetId).toBe('user');
    });

    it('should query messages with join', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values([
          {
            id: '1',
            userId,
            role: 'user',
            content: 'message 1',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: '2',
            userId,
            role: 'user',
            content: 'message 2',
            createdAt: new Date('2023-02-01'),
          },
          {
            id: '3',
            userId: otherUserId,
            role: 'user',
            content: 'message 3',
            createdAt: new Date('2023-03-01'),
          },
        ]);
        await trx.insert(files).values([
          { id: 'f-0', url: 'abc', name: 'file-1', userId, fileType: 'image/png', size: 1000 },
          { id: 'f-1', url: 'abc', name: 'file-1', userId, fileType: 'image/png', size: 100 },
          { id: 'f-3', url: 'abc', name: 'file-3', userId, fileType: 'image/png', size: 400 },
        ]);
        await trx.insert(messageTTS).values([
          { id: '1', userId },
          { id: '2', voice: 'a', fileId: 'f-1', contentMd5: 'abc', userId },
        ]);

        await trx.insert(messagesFiles).values([
          { fileId: 'f-0', messageId: '1', userId },
          { fileId: 'f-3', messageId: '1', userId },
        ]);
      });

      const domain = 'http://abc.com';
      // Call query method
      const result = await messageModel.query(
        {},
        { postProcessUrl: async (path) => `${domain}/${path}` },
      );

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[0].imageList).toEqual([
        { alt: 'file-1', id: 'f-0', url: `${domain}/abc` },
        { alt: 'file-3', id: 'f-3', url: `${domain}/abc` },
      ]);

      expect(result[1].id).toBe('2');
      expect(result[1].imageList).toEqual([]);
    });

    it('should include translate, tts and other extra fields in query result', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values([
          {
            id: '1',
            userId,
            role: 'user',
            content: 'message 1',
            createdAt: new Date('2023-01-01'),
          },
        ]);
        await trx
          .insert(messageTranslates)
          .values([{ id: '1', content: 'translated', from: 'en', to: 'zh', userId }]);
        await trx
          .insert(messageTTS)
          .values([{ id: '1', voice: 'voice1', fileId: 'f1', contentMd5: 'md5', userId }]);
      });

      // Call query method
      const result = await messageModel.query();

      // Assert result
      expect(result[0].extra!.translate).toEqual({ content: 'translated', from: 'en', to: 'zh' });
      expect(result[0].extra!.tts).toEqual({
        contentMd5: 'md5',
        file: 'f1',
        voice: 'voice1',
      });
    });

    it('should handle edge cases of pagination parameters', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId, role: 'user', content: 'message 2' },
        { id: '3', userId, role: 'user', content: 'message 3' },
      ]);

      // 测试 current 和 pageSize 的边界情况
      const result1 = await messageModel.query({ current: 0, pageSize: 2 });
      expect(result1).toHaveLength(2);

      const result2 = await messageModel.query({ current: 1, pageSize: 2 });
      expect(result2).toHaveLength(1);

      const result3 = await messageModel.query({ current: 2, pageSize: 2 });
      expect(result3).toHaveLength(0);
    });

    describe('query with messageQueries', () => {
      it('should include ragQuery, ragQueryId and ragRawQuery in query results', async () => {
        // Create test data
        const messageId = 'msg-with-query';
        const queryId = uuid();

        await serverDB.insert(messages).values({
          id: messageId,
          userId,
          role: 'user',
          content: 'test message',
        });

        await serverDB.insert(messageQueries).values({
          id: queryId,
          messageId,
          userQuery: 'original query',
          rewriteQuery: 'rewritten query',
          userId,
        });

        // Call query method
        const result = await messageModel.query();

        // Assert result
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(messageId);
        expect(result[0].ragQueryId).toBe(queryId);
        expect(result[0].ragQuery).toBe('rewritten query');
        expect(result[0].ragRawQuery).toBe('original query');
      });

      it('should handle multiple message queries for the same message', async () => {
        // Create test data
        const messageId = 'msg-multi-query';
        const queryId1 = uuid();
        const queryId2 = uuid();

        await serverDB.insert(messages).values({
          id: messageId,
          userId,
          role: 'user',
          content: 'test message',
        });

        // 创建两个查询，查询结果应该只包含其中一个
        // Note: 由于 messageQueries 表没有排序字段，返回哪个 query 是不确定的
        // 但应该只返回一个
        await serverDB.insert(messageQueries).values([
          {
            id: queryId1,
            messageId,
            userQuery: 'original query 1',
            rewriteQuery: 'rewritten query 1',
            userId,
          },
          {
            id: queryId2,
            messageId,
            userQuery: 'original query 2',
            rewriteQuery: 'rewritten query 2',
            userId,
          },
        ]);

        // Call query method
        const result = await messageModel.query();

        // Assert result - 应该只包含一个查询（具体是哪个取决于数据库实现）
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(messageId);
        // 验证返回的是两个 query 中的一个
        expect([queryId1, queryId2]).toContain(result[0].ragQueryId);
        expect(['rewritten query 1', 'rewritten query 2']).toContain(result[0].ragQuery);
        expect(['original query 1', 'original query 2']).toContain(result[0].ragRawQuery);
      });
    });

    it('should handle complex query with multiple joins and file chunks', async () => {
      await serverDB.transaction(async (trx) => {
        const chunk1Id = uuid();
        const query1Id = uuid();
        // 创建基础消息
        await trx.insert(messages).values({
          id: 'msg1',
          userId,
          role: 'user',
          content: 'test message',
          createdAt: new Date('2023-01-01'),
        });

        // 创建文件
        await trx.insert(files).values([
          {
            id: 'file1',
            userId,
            name: 'test.txt',
            url: 'test-url',
            fileType: 'text/plain',
            size: 100,
          },
        ]);

        // 创建文件块
        await trx.insert(chunks).values({
          id: chunk1Id,
          text: 'chunk content',
        });

        // 关联消息和文件
        await trx.insert(messagesFiles).values({
          messageId: 'msg1',
          userId,
          fileId: 'file1',
        });

        // 创建文件块关联
        await trx.insert(fileChunks).values({
          fileId: 'file1',
          userId,
          chunkId: chunk1Id,
        });

        // 创建消息查询
        await trx.insert(messageQueries).values({
          id: query1Id,
          messageId: 'msg1',
          userId,
          userQuery: 'original query',
          rewriteQuery: 'rewritten query',
        });

        // 创建消息查询块关联
        await trx.insert(messageQueryChunks).values({
          messageId: 'msg1',
          queryId: query1Id,
          chunkId: chunk1Id,
          similarity: '0.95',
          userId,
        });
      });

      const result = await messageModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].chunksList).toHaveLength(1);
      expect(result[0].chunksList![0]).toMatchObject({
        text: 'chunk content',
        similarity: 0.95,
      });
    });

    it('should handle null similarity in chunks and convert to number', async () => {
      await serverDB.transaction(async (trx) => {
        const chunk1Id = uuid();
        const query1Id = uuid();

        await trx.insert(messages).values({
          id: 'msg1',
          userId,
          role: 'user',
          content: 'test message',
        });

        await trx.insert(files).values({
          id: 'file1',
          userId,
          name: 'test.txt',
          url: 'test-url',
          fileType: 'text/plain',
          size: 100,
        });

        await trx.insert(chunks).values({
          id: chunk1Id,
          text: 'chunk content',
        });

        await trx.insert(fileChunks).values({
          fileId: 'file1',
          userId,
          chunkId: chunk1Id,
        });

        await trx.insert(messageQueries).values({
          id: query1Id,
          messageId: 'msg1',
          userId,
          userQuery: 'query',
          rewriteQuery: 'rewritten',
        });

        // Insert chunk with null similarity
        await trx.insert(messageQueryChunks).values({
          messageId: 'msg1',
          queryId: query1Id,
          chunkId: chunk1Id,
          similarity: null as any,
          userId,
        });
      });

      const result = await messageModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].chunksList).toHaveLength(1);
      // null should be converted to undefined
      expect(result[0].chunksList![0].similarity).toBeUndefined();
    });

    it('should return empty arrays for files and chunks if none exist', async () => {
      await serverDB.insert(messages).values({
        id: 'msg1',
        userId,
        role: 'user',
        content: 'test message',
      });

      const result = await messageModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].fileList).toEqual([]);
      expect(result[0].imageList).toEqual([]);
      expect(result[0].chunksList).toEqual([]);
    });

    it('should query messages in session with null topicId (only non-topic messages)', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-no-topic-1',
          userId,
          sessionId: 'session1',
          topicId: null,
          role: 'user',
          content: 'message without topic 1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'msg-no-topic-2',
          userId,
          sessionId: 'session1',
          topicId: null,
          role: 'assistant',
          content: 'message without topic 2',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'msg-topic1',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          role: 'user',
          content: 'message in topic1',
          createdAt: new Date('2023-01-03'),
        },
        {
          id: 'msg-topic2',
          userId,
          sessionId: 'session1',
          topicId: 'topic2',
          role: 'assistant',
          content: 'message in topic2',
          createdAt: new Date('2023-01-04'),
        },
      ]);

      // Query with explicit null topicId should return only non-topic messages
      const result = await messageModel.query({ sessionId: 'session1', topicId: null });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-no-topic-1');
      expect(result[1].id).toBe('msg-no-topic-2');
    });

    it('should query messages in session with null groupId (only non-group messages)', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(chatGroups).values([
        { id: 'group1', userId, title: 'Group 1' },
        { id: 'group2', userId, title: 'Group 2' },
      ]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-no-group-1',
          userId,
          sessionId: 'session1',
          groupId: null,
          role: 'user',
          content: 'message without group 1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'msg-no-group-2',
          userId,
          sessionId: 'session1',
          groupId: null,
          role: 'assistant',
          content: 'message without group 2',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'msg-group1',
          userId,
          sessionId: 'session1',
          groupId: 'group1',
          role: 'user',
          content: 'message in group1',
          createdAt: new Date('2023-01-03'),
        },
        {
          id: 'msg-group2',
          userId,
          sessionId: 'session1',
          groupId: 'group2',
          role: 'assistant',
          content: 'message in group2',
          createdAt: new Date('2023-01-04'),
        },
      ]);

      // Query with explicit null groupId should return only non-group messages
      const result = await messageModel.query({ sessionId: 'session1', groupId: null });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-no-group-1');
      expect(result[1].id).toBe('msg-no-group-2');
    });

    it('should query inbox messages with null topicId when no sessionId specified', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-inbox-no-topic',
          userId,
          sessionId: null, // inbox message
          topicId: null,
          role: 'user',
          content: 'inbox message without topic',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'msg-session-no-topic',
          userId,
          sessionId: 'session1',
          topicId: null,
          role: 'user',
          content: 'session message without topic',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'msg-session-with-topic',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          role: 'user',
          content: 'session message with topic',
          createdAt: new Date('2023-01-03'),
        },
      ]);

      // When no sessionId specified (defaults to inbox), query with topicId null
      // should return only inbox messages without topics
      const result = await messageModel.query({ topicId: null });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-inbox-no-topic');
    });

    it('should query messages with combined sessionId and topicId filters', async () => {
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
      ]);

      await serverDB.insert(messages).values([
        {
          id: 'msg-s1-t1',
          userId,
          sessionId: 'session1',
          topicId: 'topic1',
          role: 'user',
          content: 'session1 topic1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'msg-s1-t2',
          userId,
          sessionId: 'session1',
          topicId: 'topic2',
          role: 'user',
          content: 'session1 topic2',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'msg-s2',
          userId,
          sessionId: 'session2',
          topicId: null,
          role: 'user',
          content: 'session2 no topic',
          createdAt: new Date('2023-01-03'),
        },
      ]);

      // Query specific session and topic combination
      const result = await messageModel.query({ sessionId: 'session1', topicId: 'topic1' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-s1-t1');
    });

    describe('query with agentId filter', () => {
      // ========== Legacy data tests (messages with sessionId only) ==========
      it('should query legacy messages by agentId through agentsToSessions lookup', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([
            { id: 'session-for-agent', userId },
            { id: 'session-other', userId },
          ]);

          await trx.insert(agents).values([{ id: 'agent1', userId, title: 'Agent 1' }]);

          await trx
            .insert(agentsToSessions)
            .values([{ agentId: 'agent1', sessionId: 'session-for-agent', userId }]);

          // Legacy messages: have sessionId but no agentId
          await trx.insert(messages).values([
            {
              id: 'msg-agent-session',
              userId,
              sessionId: 'session-for-agent',
              agentId: null,
              role: 'user',
              content: 'legacy message in agent session',
              createdAt: new Date('2023-01-01'),
            },
            {
              id: 'msg-other-session',
              userId,
              sessionId: 'session-other',
              agentId: null,
              role: 'user',
              content: 'message in other session',
              createdAt: new Date('2023-01-02'),
            },
          ]);
        });

        // Query with agentId should return legacy messages from the associated session
        const result = await messageModel.query({ agentId: 'agent1' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-agent-session');
      });

      // ========== New data tests (messages with agentId directly) ==========
      it('should query messages with direct agentId match', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(agents).values([{ id: 'agent2', userId, title: 'Agent 2' }]);

          // New messages: have agentId directly stored
          await trx.insert(messages).values([
            {
              id: 'msg-with-agent-id',
              userId,
              agentId: 'agent2',
              sessionId: null,
              role: 'user',
              content: 'new message with agentId',
              createdAt: new Date('2023-01-01'),
            },
            {
              id: 'msg-without-agent-id',
              userId,
              agentId: null,
              sessionId: null,
              role: 'user',
              content: 'message without agentId',
              createdAt: new Date('2023-01-02'),
            },
          ]);
        });

        const result = await messageModel.query({ agentId: 'agent2' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-with-agent-id');
      });

      // ========== Mixed data tests (both legacy and new data) ==========
      it('should query both legacy (sessionId) and new (agentId) messages using OR condition', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([{ id: 'session-for-mixed', userId }]);

          await trx.insert(agents).values([{ id: 'agent-mixed', userId, title: 'Agent Mixed' }]);

          await trx
            .insert(agentsToSessions)
            .values([{ agentId: 'agent-mixed', sessionId: 'session-for-mixed', userId }]);

          // Mixed data: legacy message with sessionId and new message with agentId
          await trx.insert(messages).values([
            {
              id: 'msg-legacy',
              userId,
              sessionId: 'session-for-mixed',
              agentId: null,
              role: 'user',
              content: 'legacy message',
              createdAt: new Date('2023-01-01'),
            },
            {
              id: 'msg-new',
              userId,
              sessionId: null,
              agentId: 'agent-mixed',
              role: 'user',
              content: 'new message',
              createdAt: new Date('2023-01-02'),
            },
            {
              id: 'msg-unrelated',
              userId,
              sessionId: null,
              agentId: null,
              role: 'user',
              content: 'unrelated message',
              createdAt: new Date('2023-01-03'),
            },
          ]);
        });

        const result = await messageModel.query({ agentId: 'agent-mixed' });

        // Should return both legacy and new messages
        expect(result).toHaveLength(2);
        const ids = result.map((m) => m.id);
        expect(ids).toContain('msg-legacy');
        expect(ids).toContain('msg-new');
      });

      it('should not duplicate messages when both sessionId and agentId point to the same message', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([{ id: 'session-dedup', userId }]);

          await trx.insert(agents).values([{ id: 'agent-dedup', userId, title: 'Agent Dedup' }]);

          await trx
            .insert(agentsToSessions)
            .values([{ agentId: 'agent-dedup', sessionId: 'session-dedup', userId }]);

          // Message with both sessionId and agentId (transition period data)
          await trx.insert(messages).values([
            {
              id: 'msg-both',
              userId,
              sessionId: 'session-dedup',
              agentId: 'agent-dedup',
              role: 'user',
              content: 'message with both ids',
              createdAt: new Date('2023-01-01'),
            },
          ]);
        });

        const result = await messageModel.query({ agentId: 'agent-dedup' });

        // Should not duplicate - only return once
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-both');
      });

      // ========== Edge cases ==========
      it('should return empty when agentId has no associated session and no direct messages', async () => {
        await serverDB
          .insert(agents)
          .values([{ id: 'agent-no-data', userId, title: 'Agent No Data' }]);

        const result = await messageModel.query({ agentId: 'agent-no-data' });

        expect(result).toHaveLength(0);
      });

      it('should query messages by agentId only (no associated sessionId in agentsToSessions)', async () => {
        await serverDB.transaction(async (trx) => {
          await trx
            .insert(agents)
            .values([{ id: 'agent-no-session', userId, title: 'Agent No Session' }]);

          // Message with agentId but agent has no session association
          await trx.insert(messages).values([
            {
              id: 'msg-agent-only',
              userId,
              agentId: 'agent-no-session',
              sessionId: null,
              role: 'user',
              content: 'agent only message',
              createdAt: new Date('2023-01-01'),
            },
          ]);
        });

        const result = await messageModel.query({ agentId: 'agent-no-session' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-agent-only');
      });

      // ========== User isolation tests ==========
      it('should only return messages belonging to the current user', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([
            { id: 'session-isolation', userId },
            { id: 'session-other-user', userId: otherUserId },
          ]);

          await trx.insert(agents).values([
            { id: 'agent-isolation', userId, title: 'Agent Isolation' },
            { id: 'agent-other', userId: otherUserId, title: 'Agent Other' },
          ]);

          await trx.insert(agentsToSessions).values([
            { agentId: 'agent-isolation', sessionId: 'session-isolation', userId },
            { agentId: 'agent-other', sessionId: 'session-other-user', userId: otherUserId },
          ]);

          await trx.insert(messages).values([
            {
              id: 'msg-user',
              userId,
              agentId: 'agent-isolation',
              role: 'user',
              content: 'user message',
              createdAt: new Date('2023-01-01'),
            },
            {
              id: 'msg-other-user',
              userId: otherUserId,
              agentId: 'agent-other',
              role: 'user',
              content: 'other user message',
              createdAt: new Date('2023-01-02'),
            },
          ]);
        });

        const result = await messageModel.query({ agentId: 'agent-isolation' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-user');
      });

      // ========== Pagination tests ==========
      it('should support pagination when querying by agentId', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(agents).values([{ id: 'agent-page', userId, title: 'Agent Page' }]);

          await trx.insert(messages).values([
            {
              id: 'msg-page-1',
              userId,
              agentId: 'agent-page',
              role: 'user',
              content: 'page 1',
              createdAt: new Date('2023-01-01'),
            },
            {
              id: 'msg-page-2',
              userId,
              agentId: 'agent-page',
              role: 'user',
              content: 'page 2',
              createdAt: new Date('2023-01-02'),
            },
            {
              id: 'msg-page-3',
              userId,
              agentId: 'agent-page',
              role: 'user',
              content: 'page 3',
              createdAt: new Date('2023-01-03'),
            },
          ]);
        });

        const result1 = await messageModel.query({
          agentId: 'agent-page',
          current: 0,
          pageSize: 2,
        });
        expect(result1).toHaveLength(2);
        expect(result1[0].id).toBe('msg-page-1'); // ordered by createdAt asc
        expect(result1[1].id).toBe('msg-page-2');

        const result2 = await messageModel.query({
          agentId: 'agent-page',
          current: 1,
          pageSize: 2,
        });
        expect(result2).toHaveLength(1);
        expect(result2[0].id).toBe('msg-page-3');
      });

      it('should work with agentId and topicId filters combined', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([{ id: 'agent-session', userId }]);

          await trx.insert(agents).values([{ id: 'agent1', userId, title: 'Agent 1' }]);

          await trx
            .insert(agentsToSessions)
            .values([{ agentId: 'agent1', sessionId: 'agent-session', userId }]);

          await trx.insert(topics).values([
            { id: 'topic1', sessionId: 'agent-session', userId },
            { id: 'topic2', sessionId: 'agent-session', userId },
          ]);

          await trx.insert(messages).values([
            {
              id: 'msg-topic1',
              userId,
              sessionId: 'agent-session',
              topicId: 'topic1',
              role: 'user',
              content: 'message in topic1',
              createdAt: new Date('2023-01-01'),
            },
            {
              id: 'msg-topic2',
              userId,
              sessionId: 'agent-session',
              topicId: 'topic2',
              role: 'user',
              content: 'message in topic2',
              createdAt: new Date('2023-01-02'),
            },
          ]);
        });

        // Query with agentId and topicId
        const result = await messageModel.query({ agentId: 'agent1', topicId: 'topic1' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-topic1');
      });

      it('should only lookup agentsToSessions for current user', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([
            { id: 'user-session', userId },
            { id: 'other-user-session', userId: otherUserId },
          ]);

          // Different agent IDs for different users (agent id is primary key)
          await trx.insert(agents).values([
            { id: 'user-agent', userId, title: 'User Agent' },
            { id: 'other-user-agent', userId: otherUserId, title: 'Other User Agent' },
          ]);

          // Only create agentsToSessions for the other user
          await trx
            .insert(agentsToSessions)
            .values([
              { agentId: 'other-user-agent', sessionId: 'other-user-session', userId: otherUserId },
            ]);

          await trx.insert(messages).values([
            {
              id: 'msg-user',
              userId,
              sessionId: null, // inbox
              agentId: null,
              role: 'user',
              content: 'user message',
            },
            {
              id: 'msg-other-user',
              userId: otherUserId,
              sessionId: 'other-user-session',
              role: 'user',
              content: 'other user message',
            },
          ]);
        });

        // Query with other user's agentId - should not find association since it belongs to other user
        // and no direct agentId match either
        const result = await messageModel.query({ agentId: 'other-user-agent' });

        // Should return empty (no agentId match and no session found for this user)
        expect(result).toHaveLength(0);
      });

      // ========== Backward compatibility: sessionId query still works ==========
      it('should still work with sessionId query (backward compatibility)', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(sessions).values([{ id: 'session-compat', userId }]);

          await trx.insert(messages).values([
            {
              id: 'msg-session-compat',
              userId,
              sessionId: 'session-compat',
              role: 'user',
              content: 'message with sessionId',
              createdAt: new Date('2023-01-01'),
            },
          ]);
        });

        // Query with sessionId should still work
        const result = await messageModel.query({ sessionId: 'session-compat' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-session-compat');
      });
    });
  });

  describe('queryAll', () => {
    it('should return all messages belonging to the user in ascending order', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          content: 'message 1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          content: 'message 2',
          createdAt: new Date('2023-02-01'),
        },
        {
          id: '3',
          userId: otherUserId,
          role: 'user',
          content: 'message 3',
          createdAt: new Date('2023-03-01'),
        },
      ]);

      // Call queryAll method
      const result = await messageModel.queryAll();

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });
  });

  describe('findById', () => {
    it('should find message by ID', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'message 1' },
        { id: '2', userId: otherUserId, role: 'user', content: 'message 2' },
      ]);

      // Call findById method
      const result = await messageModel.findById('1');

      // Assert result
      expect(result?.id).toBe('1');
      expect(result?.content).toBe('message 1');
    });

    it('should return undefined if message does not belong to user', async () => {
      // Create test data
      await serverDB
        .insert(messages)
        .values([{ id: '1', userId: otherUserId, role: 'user', content: 'message 1' }]);

      // Call findById method
      const result = await messageModel.findById('1');

      // Assert result
      expect(result).toBeUndefined();
    });
  });

  describe('queryBySessionId', () => {
    it('should query messages by sessionId', async () => {
      // Create test data
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);
      await serverDB.insert(messages).values([
        {
          id: '1',
          userId,
          role: 'user',
          sessionId,
          content: 'message 1',
          createdAt: new Date('2022-01-01'),
        },
        {
          id: '2',
          userId,
          role: 'user',
          sessionId,
          content: 'message 2',
          createdAt: new Date('2023-02-01'),
        },
        { id: '3', userId, role: 'user', sessionId: 'session2', content: 'message 3' },
      ]);

      // Call queryBySessionId method
      const result = await messageModel.queryBySessionId(sessionId);

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should query inbox messages when sessionId is null', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);

      await serverDB.insert(messages).values([
        {
          id: 'inbox-msg-1',
          userId,
          sessionId: null, // inbox message
          role: 'user',
          content: 'inbox message 1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'inbox-msg-2',
          userId,
          sessionId: null, // inbox message
          role: 'assistant',
          content: 'inbox message 2',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'session-msg',
          userId,
          sessionId: 'session1',
          role: 'user',
          content: 'session message',
          createdAt: new Date('2023-01-03'),
        },
      ]);

      // Query with null sessionId should return only inbox messages
      const result = await messageModel.queryBySessionId(null);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('inbox-msg-1');
      expect(result[1].id).toBe('inbox-msg-2');
    });

    it('should query inbox messages when sessionId is undefined', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);

      await serverDB.insert(messages).values([
        {
          id: 'inbox-msg',
          userId,
          sessionId: null,
          role: 'user',
          content: 'inbox message',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'session-msg',
          userId,
          sessionId: 'session1',
          role: 'user',
          content: 'session message',
          createdAt: new Date('2023-01-02'),
        },
      ]);

      // Query with undefined sessionId should also return inbox messages
      const result = await messageModel.queryBySessionId(undefined);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inbox-msg');
    });

    it('should query inbox messages when sessionId is INBOX_SESSION_ID', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);

      await serverDB.insert(messages).values([
        {
          id: 'inbox-msg-1',
          userId,
          sessionId: null,
          role: 'user',
          content: 'inbox message 1',
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'inbox-msg-2',
          userId,
          sessionId: null,
          role: 'assistant',
          content: 'inbox message 2',
          createdAt: new Date('2023-01-02'),
        },
        {
          id: 'session-msg',
          userId,
          sessionId: 'session1',
          role: 'user',
          content: 'session message',
          createdAt: new Date('2023-01-03'),
        },
      ]);

      // Query with INBOX_SESSION_ID should return only inbox messages
      const result = await messageModel.queryBySessionId(INBOX_SESSION_ID);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('inbox-msg-1');
      expect(result[1].id).toBe('inbox-msg-2');
    });
  });

  describe('queryByKeyWord', () => {
    it('should query messages by keyword', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'apple', createdAt: new Date('2022-02-01') },
        { id: '2', userId, role: 'user', content: 'banana' },
        { id: '3', userId, role: 'user', content: 'pear' },
        { id: '4', userId, role: 'user', content: 'apple pie', createdAt: new Date('2024-02-01') },
      ]);

      // Test querying messages with specific keyword
      const result = await messageModel.queryByKeyword('apple');

      // Assert result
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('4');
      expect(result[1].id).toBe('1');
    });

    it('should return empty array when keyword is empty', async () => {
      // Create test data
      await serverDB.insert(messages).values([
        { id: '1', userId, role: 'user', content: 'apple' },
        { id: '2', userId, role: 'user', content: 'banana' },
        { id: '3', userId, role: 'user', content: 'pear' },
        { id: '4', userId, role: 'user', content: 'apple pie' },
      ]);

      // Test returning empty array when keyword is empty
      const result = await messageModel.queryByKeyword('');

      // Assert result
      expect(result).toHaveLength(0);
    });
  });

  describe('query with files edge cases', () => {
    it('should handle files with empty fileType', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({ id: 'session1', userId });

        // Create files with empty string fileType (tests the || '' branch)
        await trx.insert(files).values([
          {
            id: 'file-empty-type',
            userId,
            url: 'unknown.bin',
            name: 'unknown file',
            fileType: '',
            size: 1000,
          },
          {
            id: 'file-image',
            userId,
            url: 'image.png',
            name: 'test image',
            fileType: 'image/png',
            size: 2000,
          },
          {
            id: 'file-video',
            userId,
            url: 'video.mp4',
            name: 'test video',
            fileType: 'video/mp4',
            size: 3000,
          },
        ]);

        const messageId = uuid();
        await trx.insert(messages).values({
          id: messageId,
          userId,
          role: 'user',
          content: 'Message with various fileTypes',
          sessionId: 'session1',
        });

        await trx.insert(messagesFiles).values([
          { messageId, fileId: 'file-empty-type', userId },
          { messageId, fileId: 'file-image', userId },
          { messageId, fileId: 'file-video', userId },
        ]);
      });

      const result = await messageModel.query({ sessionId: 'session1' });

      expect(result).toHaveLength(1);
      expect(result[0].fileList).toHaveLength(1); // empty fileType should go to fileList
      expect(result[0].fileList![0].id).toBe('file-empty-type');
      expect(result[0].imageList).toHaveLength(1);
      expect(result[0].imageList![0].id).toBe('file-image');
      expect(result[0].videoList).toHaveLength(1);
      expect(result[0].videoList![0].id).toBe('file-video');
    });
  });

  describe('query with documents', () => {
    it('should include document content when files have associated documents', async () => {
      // Create a file with an associated document
      const fileId = uuid();

      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values({ id: 'session1', userId });

        await trx.insert(files).values({
          id: fileId,
          userId,
          url: 'document.pdf',
          name: 'test.pdf',
          fileType: 'application/pdf',
          size: 5000,
        });

        await trx.insert(documents).values({
          fileId,
          userId,
          content: 'This is the document content for testing',
          fileType: 'application/pdf',
          sourceType: 'file',
          source: 'document.pdf',
          totalCharCount: 42,
          totalLineCount: 1,
        });

        const messageId = uuid();
        await trx.insert(messages).values({
          id: messageId,
          userId,
          role: 'user',
          content: 'Message with document',
          sessionId: 'session1',
        });

        await trx.insert(messagesFiles).values({
          messageId,
          fileId,
          userId,
        });
      });

      // Query messages - this should trigger the documents processing code
      const result = await messageModel.query({ sessionId: 'session1' });

      expect(result).toHaveLength(1);
      expect(result[0].fileList).toBeDefined();
      expect(result[0].fileList).toHaveLength(1);
      expect(result[0].fileList![0].id).toBe(fileId);
      expect(result[0].fileList![0].content).toBe('This is the document content for testing');
    });
  });

  describe('query messages with threadId filter', () => {
    it('should filter messages by threadId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create threads first due to foreign key constraint
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-1',
            type: 'standalone',
          },
          {
            id: 'thread2',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-2',
            type: 'standalone',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg-thread-1',
            userId,
            sessionId: 'session1',
            threadId: 'thread1',
            role: 'user',
            content: 'message in thread 1',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg-thread-2',
            userId,
            sessionId: 'session1',
            threadId: 'thread1',
            role: 'assistant',
            content: 'another message in thread 1',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg-thread-other',
            userId,
            sessionId: 'session1',
            threadId: 'thread2',
            role: 'user',
            content: 'message in thread 2',
            createdAt: new Date('2023-01-03'),
          },
          {
            id: 'msg-no-thread',
            userId,
            sessionId: 'session1',
            threadId: null,
            role: 'user',
            content: 'message without thread',
            createdAt: new Date('2023-01-04'),
          },
        ]);
      });

      // Query messages in specific thread
      const result = await messageModel.query({ sessionId: 'session1', threadId: 'thread1' });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-thread-1');
      expect(result[1].id).toBe('msg-thread-2');
    });

    it('should query messages with null threadId (only non-thread messages)', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create thread first
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-1',
            type: 'standalone',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg-no-thread-1',
            userId,
            sessionId: 'session1',
            threadId: null,
            role: 'user',
            content: 'message without thread 1',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg-no-thread-2',
            userId,
            sessionId: 'session1',
            threadId: null,
            role: 'assistant',
            content: 'message without thread 2',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg-thread-1',
            userId,
            sessionId: 'session1',
            threadId: 'thread1',
            role: 'user',
            content: 'message in thread 1',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      // Query with explicit null threadId should return only non-thread messages
      const result = await messageModel.query({ sessionId: 'session1', threadId: null });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-no-thread-1');
      expect(result[1].id).toBe('msg-no-thread-2');
    });

    it('should query messages with combined sessionId, topicId and threadId filters', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create threads first
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-1',
            type: 'standalone',
          },
          {
            id: 'thread2',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-2',
            type: 'standalone',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg-all-filters',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread1',
            role: 'user',
            content: 'message with all filters',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg-diff-thread',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: 'thread2',
            role: 'user',
            content: 'message with different thread',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg-no-thread',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'message without thread',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      // Query specific session, topic and thread combination
      const result = await messageModel.query({
        sessionId: 'session1',
        topicId: 'topic1',
        threadId: 'thread1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-all-filters');
    });

    it('should query messages by threadId with sessionId but without topicId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Create threads first
        await trx.insert(threads).values([
          {
            id: 'thread1',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-1',
            type: 'standalone',
          },
          {
            id: 'thread2',
            userId,
            topicId: 'topic1',
            sourceMessageId: 'source-msg-2',
            type: 'standalone',
          },
        ]);

        await trx.insert(messages).values([
          {
            id: 'msg-thread-1',
            userId,
            sessionId: 'session1',
            threadId: 'thread1',
            role: 'user',
            content: 'message in thread 1',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg-thread-2',
            userId,
            sessionId: 'session1',
            threadId: 'thread2',
            role: 'user',
            content: 'message in thread 2',
            createdAt: new Date('2023-01-02'),
          },
        ]);
      });

      // Query by sessionId and threadId without topicId
      const result = await messageModel.query({ sessionId: 'session1', threadId: 'thread1' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-thread-1');
    });
  });

  describe('findMessageQueriesById', () => {
    it('should return undefined for non-existent message query', async () => {
      const result = await messageModel.findMessageQueriesById('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return message query with embeddings', async () => {
      const query1Id = uuid();
      const embeddings1Id = uuid();

      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({ id: 'msg1', userId, role: 'user', content: 'abc' });

        await trx.insert(embeddings).values({
          id: embeddings1Id,
          embeddings: codeEmbedding,
        });

        await trx.insert(messageQueries).values({
          id: query1Id,
          messageId: 'msg1',
          userQuery: 'test query',
          rewriteQuery: 'rewritten query',
          embeddingsId: embeddings1Id,
          userId,
        });
      });

      const result = await messageModel.findMessageQueriesById('msg1');

      expect(result).toBeDefined();
      expect(result).toMatchObject({
        id: query1Id,
        userQuery: 'test query',
        rewriteQuery: 'rewritten query',
        embeddings: codeEmbedding,
      });
    });
  });

  describe('getThreadParentMessages', () => {
    it('should return only source message for Standalone thread type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

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
            content: 'second message',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third message - source',
            createdAt: new Date('2023-01-03'),
          },
          {
            id: 'msg4',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'fourth message',
            createdAt: new Date('2023-01-04'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg3',
        topicId: 'topic1',
        threadType: 'standalone' as any,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg3');
      expect(result[0].content).toBe('third message - source');
    });

    it('should return all messages up to source message for Continuation thread type', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

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
            content: 'second message',
            createdAt: new Date('2023-01-02'),
          },
          {
            id: 'msg3',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'user',
            content: 'third message - source',
            createdAt: new Date('2023-01-03'),
          },
          {
            id: 'msg4',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'fourth message - after source',
            createdAt: new Date('2023-01-04'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg3',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      // Should include msg1, msg2, msg3 (up to and including source)
      // Should NOT include msg4 (after source)
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg1');
      expect(result[1].id).toBe('msg2');
      expect(result[2].id).toBe('msg3');
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
            sourceMessageId: 'msg2',
            type: 'standalone',
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
            content: 'main message 1',
            createdAt: new Date('2023-01-01'),
          },
          {
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'main message 2 - source',
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
            content: 'main message 3 - new source',
            createdAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg3',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      // Should include msg1, msg2, msg3 (main conversation only)
      // Should NOT include msg-in-thread (belongs to another thread)
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['msg1', 'msg2', 'msg3']);
    });

    it('should return empty array for non-existent source message', async () => {
      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'non-existent',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      expect(result).toHaveLength(0);
    });

    it('should return messages in chronological order', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx.insert(topics).values([{ id: 'topic1', sessionId: 'session1', userId }]);

        // Insert in non-chronological order
        await trx.insert(messages).values([
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
        ]);
      });

      const result = await messageModel.getThreadParentMessages({
        sourceMessageId: 'msg3',
        topicId: 'topic1',
        threadType: 'continuation' as any,
      });

      // Should be in chronological order regardless of insert order
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg1');
      expect(result[1].id).toBe('msg2');
      expect(result[2].id).toBe('msg3');
    });
  });

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

    it('should return messages in chronological order', async () => {
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
            id: 'msg2',
            userId,
            sessionId: 'session1',
            topicId: 'topic1',
            threadId: null,
            role: 'assistant',
            content: 'second message - source',
            createdAt: new Date('2023-01-02'),
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

        // Create messages
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

        // Create messages
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
            createdAt: new Date('2023-01-03'),
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

  describe('Group Chat message query scenarios', () => {
    /**
     * Scenario 1: Group Chat main channel
     *
     * In Group Chat, all messages in the main channel should have:
     * - groupId: the same group ID
     * - agentId: different for each agent (user, supervisor, agent-1, agent-2)
     * - topicId: same topic or null
     *
     * When querying by groupId, should return ALL messages regardless of agentId
     */
    describe('main channel messages', () => {
      it('should return all messages from user, supervisor, and multiple agents when querying by groupId', async () => {
        await serverDB.transaction(async (trx) => {
          // Create group and agents
          await trx
            .insert(chatGroups)
            .values([{ id: 'group-chat-1', userId, title: 'Group Chat 1' }]);

          await trx.insert(agents).values([
            { id: 'supervisor-agent', userId, title: 'Supervisor' },
            { id: 'agent-1', userId, title: 'Data Analyst' },
            { id: 'agent-2', userId, title: 'Code Writer' },
          ]);

          await trx.insert(topics).values([{ id: 'topic-group-1', userId }]);

          // Create messages from different agents in the same group
          await trx.insert(messages).values([
            // User message
            {
              id: 'msg-user',
              userId,
              role: 'user',
              content: 'Analyze the weather data for Hangzhou',
              groupId: 'group-chat-1',
              agentId: 'supervisor-agent', // User message uses supervisor's agentId
              topicId: 'topic-group-1',
              createdAt: new Date('2024-01-01T10:00:00'),
            },
            // Supervisor's first response with tool call
            {
              id: 'msg-supervisor-1',
              userId,
              role: 'assistant',
              content: 'I will delegate this to the Data Analyst.',
              groupId: 'group-chat-1',
              agentId: 'supervisor-agent',
              topicId: 'topic-group-1',
              createdAt: new Date('2024-01-01T10:01:00'),
            },
            // Tool message for delegation
            {
              id: 'msg-tool-delegate',
              userId,
              role: 'tool',
              content: 'Triggered agent "agent-1" to respond.',
              groupId: 'group-chat-1',
              agentId: 'supervisor-agent',
              topicId: 'topic-group-1',
              createdAt: new Date('2024-01-01T10:01:30'),
            },
            // Agent-1 (Data Analyst) response
            {
              id: 'msg-agent1-response',
              userId,
              role: 'assistant',
              content: 'Based on the weather data, Hangzhou has...',
              groupId: 'group-chat-1',
              agentId: 'agent-1',
              topicId: 'topic-group-1',
              createdAt: new Date('2024-01-01T10:02:00'),
            },
            // Supervisor asks Agent-2
            {
              id: 'msg-supervisor-2',
              userId,
              role: 'assistant',
              content: 'Let me also get some code analysis.',
              groupId: 'group-chat-1',
              agentId: 'supervisor-agent',
              topicId: 'topic-group-1',
              createdAt: new Date('2024-01-01T10:03:00'),
            },
            // Agent-2 (Code Writer) response
            {
              id: 'msg-agent2-response',
              userId,
              role: 'assistant',
              content: 'Here is the code to visualize the data...',
              groupId: 'group-chat-1',
              agentId: 'agent-2',
              topicId: 'topic-group-1',
              createdAt: new Date('2024-01-01T10:04:00'),
            },
          ]);
        });

        // Query by groupId - should return ALL messages from all agents
        const result = await messageModel.query({
          groupId: 'group-chat-1',
          topicId: 'topic-group-1',
        });

        // Should return all 6 messages
        expect(result).toHaveLength(6);

        // Verify each message has correct agentId
        const messageMap = new Map(result.map((m) => [m.id, m]));

        expect(messageMap.get('msg-user')?.agentId).toBe('supervisor-agent');
        expect(messageMap.get('msg-supervisor-1')?.agentId).toBe('supervisor-agent');
        expect(messageMap.get('msg-tool-delegate')?.agentId).toBe('supervisor-agent');
        expect(messageMap.get('msg-agent1-response')?.agentId).toBe('agent-1');
        expect(messageMap.get('msg-supervisor-2')?.agentId).toBe('supervisor-agent');
        expect(messageMap.get('msg-agent2-response')?.agentId).toBe('agent-2');

        // All messages should have the same groupId
        for (const msg of result) {
          expect(msg.groupId).toBe('group-chat-1');
        }

        // Verify chronological order
        expect(result.map((m) => m.id)).toEqual([
          'msg-user',
          'msg-supervisor-1',
          'msg-tool-delegate',
          'msg-agent1-response',
          'msg-supervisor-2',
          'msg-agent2-response',
        ]);
      });

      it('should not return messages from different groups', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(chatGroups).values([
            { id: 'group-1', userId, title: 'Group 1' },
            { id: 'group-2', userId, title: 'Group 2' },
          ]);

          await trx.insert(agents).values([
            { id: 'agent-g1', userId, title: 'Agent G1' },
            { id: 'agent-g2', userId, title: 'Agent G2' },
          ]);

          await trx.insert(messages).values([
            {
              id: 'msg-g1',
              userId,
              role: 'user',
              content: 'Message in group 1',
              groupId: 'group-1',
              agentId: 'agent-g1',
              createdAt: new Date('2024-01-01'),
            },
            {
              id: 'msg-g2',
              userId,
              role: 'user',
              content: 'Message in group 2',
              groupId: 'group-2',
              agentId: 'agent-g2',
              createdAt: new Date('2024-01-02'),
            },
          ]);
        });

        const result = await messageModel.query({ groupId: 'group-1' });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('msg-g1');
      });
    });

    /**
     * Scenario 2: Agent's private trajectory (thread)
     *
     * When an agent executes a task, it may create messages in its own thread.
     * These messages should:
     * - Have the same groupId as the main conversation
     * - Have the agent's agentId
     * - Have a threadId pointing to the agent's execution trajectory
     *
     * When querying by threadId, should return only the agent's trajectory messages
     */
    describe('agent private trajectory (thread)', () => {
      it('should return only agent-1 trajectory messages when querying by threadId', async () => {
        await serverDB.transaction(async (trx) => {
          await trx
            .insert(chatGroups)
            .values([{ id: 'group-chat-1', userId, title: 'Group Chat' }]);

          await trx.insert(agents).values([
            { id: 'supervisor', userId, title: 'Supervisor' },
            { id: 'agent-1', userId, title: 'Data Analyst' },
          ]);

          await trx.insert(topics).values([{ id: 'topic-1', userId }]);

          // Create thread for agent-1's execution trajectory
          await trx.insert(threads).values([
            {
              id: 'agent-1-trajectory',
              userId,
              topicId: 'topic-1',
              sourceMessageId: 'msg-delegate-to-agent1', // Source is the delegation message
              type: 'standalone',
            },
          ]);

          // Main channel messages
          await trx.insert(messages).values([
            // User's request
            {
              id: 'msg-user-request',
              userId,
              role: 'user',
              content: 'Analyze weather data',
              groupId: 'group-chat-1',
              agentId: 'supervisor',
              topicId: 'topic-1',
              threadId: null,
              createdAt: new Date('2024-01-01T10:00:00'),
            },
            // Supervisor delegates to agent-1
            {
              id: 'msg-delegate-to-agent1',
              userId,
              role: 'assistant',
              content: 'Delegating to Data Analyst',
              groupId: 'group-chat-1',
              agentId: 'supervisor',
              topicId: 'topic-1',
              threadId: null,
              createdAt: new Date('2024-01-01T10:01:00'),
            },
            // Agent-1's execution trajectory (in thread)
            {
              id: 'msg-agent1-step1',
              userId,
              role: 'assistant',
              content: 'Starting data analysis...',
              groupId: 'group-chat-1',
              agentId: 'agent-1',
              topicId: 'topic-1',
              threadId: 'agent-1-trajectory',
              createdAt: new Date('2024-01-01T10:02:00'),
            },
            {
              id: 'msg-agent1-tool-call',
              userId,
              role: 'tool',
              content: 'Fetched weather API data',
              groupId: 'group-chat-1',
              agentId: 'agent-1',
              topicId: 'topic-1',
              threadId: 'agent-1-trajectory',
              createdAt: new Date('2024-01-01T10:02:30'),
            },
            {
              id: 'msg-agent1-step2',
              userId,
              role: 'assistant',
              content: 'Analysis complete. Temperature trend shows...',
              groupId: 'group-chat-1',
              agentId: 'agent-1',
              topicId: 'topic-1',
              threadId: 'agent-1-trajectory',
              createdAt: new Date('2024-01-01T10:03:00'),
            },
            // Final response in main channel (no threadId)
            {
              id: 'msg-agent1-final',
              userId,
              role: 'assistant',
              content: 'Here is my analysis summary...',
              groupId: 'group-chat-1',
              agentId: 'agent-1',
              topicId: 'topic-1',
              threadId: null,
              createdAt: new Date('2024-01-01T10:04:00'),
            },
          ]);
        });

        // Query agent-1's trajectory by threadId
        const trajectoryResult = await messageModel.query({
          threadId: 'agent-1-trajectory',
        });

        // Should return source message + thread messages
        expect(trajectoryResult).toHaveLength(4);
        expect(trajectoryResult.map((m) => m.id)).toEqual([
          'msg-delegate-to-agent1', // Source message
          'msg-agent1-step1',
          'msg-agent1-tool-call',
          'msg-agent1-step2',
        ]);

        // All trajectory messages should have the same groupId and agent-1's agentId
        for (const msg of trajectoryResult.slice(1)) {
          // Skip source message
          expect(msg.groupId).toBe('group-chat-1');
          expect(msg.agentId).toBe('agent-1');
          expect(msg.threadId).toBe('agent-1-trajectory');
        }

        // Query main channel by groupId (should include all non-thread messages)
        const mainChannelResult = await messageModel.query({
          groupId: 'group-chat-1',
          topicId: 'topic-1',
          threadId: null, // Explicitly null to get main channel only
        });

        // Should return main channel messages only
        expect(mainChannelResult).toHaveLength(3);
        expect(mainChannelResult.map((m) => m.id)).toEqual([
          'msg-user-request',
          'msg-delegate-to-agent1',
          'msg-agent1-final',
        ]);
      });

      it('should return separate trajectories for different agents', async () => {
        await serverDB.transaction(async (trx) => {
          await trx.insert(chatGroups).values([{ id: 'group-1', userId, title: 'Group' }]);

          await trx.insert(agents).values([
            { id: 'supervisor', userId, title: 'Supervisor' },
            { id: 'agent-1', userId, title: 'Agent 1' },
            { id: 'agent-2', userId, title: 'Agent 2' },
          ]);

          await trx.insert(topics).values([{ id: 'topic-1', userId }]);

          // Create threads for each agent's trajectory
          await trx.insert(threads).values([
            {
              id: 'agent-1-thread',
              userId,
              topicId: 'topic-1',
              sourceMessageId: 'msg-source-1',
              type: 'standalone',
            },
            {
              id: 'agent-2-thread',
              userId,
              topicId: 'topic-1',
              sourceMessageId: 'msg-source-2',
              type: 'standalone',
            },
          ]);

          await trx.insert(messages).values([
            // Source messages
            {
              id: 'msg-source-1',
              userId,
              role: 'assistant',
              content: 'Delegating to Agent 1',
              groupId: 'group-1',
              agentId: 'supervisor',
              topicId: 'topic-1',
              threadId: null,
              createdAt: new Date('2024-01-01T10:00:00'),
            },
            {
              id: 'msg-source-2',
              userId,
              role: 'assistant',
              content: 'Delegating to Agent 2',
              groupId: 'group-1',
              agentId: 'supervisor',
              topicId: 'topic-1',
              threadId: null,
              createdAt: new Date('2024-01-01T10:05:00'),
            },
            // Agent-1 trajectory
            {
              id: 'msg-agent1-work',
              userId,
              role: 'assistant',
              content: 'Agent 1 working...',
              groupId: 'group-1',
              agentId: 'agent-1',
              topicId: 'topic-1',
              threadId: 'agent-1-thread',
              createdAt: new Date('2024-01-01T10:01:00'),
            },
            // Agent-2 trajectory
            {
              id: 'msg-agent2-work',
              userId,
              role: 'assistant',
              content: 'Agent 2 working...',
              groupId: 'group-1',
              agentId: 'agent-2',
              topicId: 'topic-1',
              threadId: 'agent-2-thread',
              createdAt: new Date('2024-01-01T10:06:00'),
            },
          ]);
        });

        // Query agent-1's trajectory
        const agent1Result = await messageModel.query({ threadId: 'agent-1-thread' });
        expect(agent1Result).toHaveLength(2);
        expect(agent1Result.map((m) => m.id)).toEqual(['msg-source-1', 'msg-agent1-work']);
        expect(agent1Result[1].agentId).toBe('agent-1');

        // Query agent-2's trajectory
        const agent2Result = await messageModel.query({ threadId: 'agent-2-thread' });
        expect(agent2Result).toHaveLength(2);
        expect(agent2Result.map((m) => m.id)).toEqual(['msg-source-2', 'msg-agent2-work']);
        expect(agent2Result[1].agentId).toBe('agent-2');

        // Both trajectories should have the same groupId
        expect(agent1Result[1].groupId).toBe('group-1');
        expect(agent2Result[1].groupId).toBe('group-1');
      });
    });
  });
});
