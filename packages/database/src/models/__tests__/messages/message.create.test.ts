import type { DBMessageItem } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import {
  chatGroups,
  chunks,
  embeddings,
  files,
  messagePlugins,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  sessions,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { codeEmbedding } from '../fixtures/embedding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-create-test';
const otherUserId = 'message-create-test-other';
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

describe('MessageModel Create Tests', () => {
  describe('createMessage', () => {
    it('should create a new message', async () => {
      // Call createMessage method
      await messageModel.create({ role: 'user', content: 'new message', sessionId: '1' });

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('new message');
    });

    it('should create a message', async () => {
      const sessionId = 'session1';
      await serverDB.insert(sessions).values([{ id: sessionId, userId }]);

      const result = await messageModel.create({
        content: 'message 1',
        role: 'user',
        sessionId: 'session1',
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe('message 1');
      expect(result.role).toBe('user');
      expect(result.sessionId).toBe('session1');
      expect(result.userId).toBe(userId);
    });

    it('should generate message ID automatically', async () => {
      // Call createMessage method
      await messageModel.create({
        role: 'user',
        content: 'new message',
        sessionId: '1',
      });

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result[0].id).toBeDefined();
      expect(result[0].id).toHaveLength(18);
    });

    it('should create a tool message and insert into messagePlugins table', async () => {
      // Call create method
      const result = await messageModel.create({
        content: 'message 1',
        role: 'tool',
        sessionId: '1',
        tool_call_id: 'tool1',
        plugin: {
          apiName: 'api1',
          arguments: 'arg1',
          identifier: 'plugin1',
          type: 'default',
        },
      });

      // Assert result
      expect(result.id).toBeDefined();
      expect(result.content).toBe('message 1');
      expect(result.role).toBe('tool');
      expect(result.sessionId).toBe('1');

      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('plugin1');
    });

    it('should create tool message ', async () => {
      // Call create method
      const state = {
        query: 'Composio',
        answers: [],
        results: [
          {
            url: 'https://www.composio.dev/',
            score: 16,
            title: 'Composio - Connect 90+ tools to your AI agents',
            engine: 'bing',
            content:
              'Faster DevelopmentHigher ReliabilityBetter Integrations. Get Started Now. Our platform lets you ditch the specs and seamlessly integrate any tool you need in less than 5 mins.',
            engines: ['bing', 'qwant', 'brave', 'duckduckgo'],
            category: 'general',
            template: 'default.html',
            positions: [1, 1, 1, 1],
            thumbnail: '',
            parsed_url: ['https', 'www.composio.dev', '/', '', '', ''],
            publishedDate: null,
          },
          {
            url: 'https://www.composio.co/',
            score: 10.75,
            title: 'Composio',
            engine: 'bing',
            content:
              'Composio was created to help streamline the entire book creation process! Writing. Take time out to write / Make a schedule to write consistently. We have writing software that optimizes your books for printing or ebook format. Figure out what you want to write. Collaborate and write with others. Professional editing is a necessity.',
            engines: ['qwant', 'duckduckgo', 'google', 'bing', 'brave'],
            category: 'general',
            template: 'default.html',
            positions: [5, 2, 1, 5, 4],
            thumbnail: null,
            parsed_url: ['https', 'www.composio.co', '/', '', '', ''],
            publishedDate: null,
          },
        ],
        unresponsive_engines: [],
      };
      const result = await messageModel.create({
        content: '[{}]',
        plugin: {
          apiName: 'searchWithSearXNG',
          arguments: '{\n  "query": "Composio"\n}',
          identifier: 'lobe-web-browsing',
          type: 'builtin',
        },
        pluginState: state,
        role: 'tool',
        tool_call_id: 'tool_call_ymxXC2J0',
        sessionId: '1',
      });

      // Assert result
      expect(result.id).toBeDefined();
      expect(result.content).toBe('[{}]');
      expect(result.role).toBe('tool');
      expect(result.sessionId).toBe('1');

      const pluginResult = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, result.id));
      expect(pluginResult).toHaveLength(1);
      expect(pluginResult[0].identifier).toBe('lobe-web-browsing');
      expect(pluginResult[0].state!).toMatchObject(state);
    });

    describe('create with advanced parameters', () => {
      it('should create a message with custom ID', async () => {
        const customId = 'custom-msg-id';

        const result = await messageModel.create(
          {
            role: 'user',
            content: 'message with custom ID',
            sessionId: '1',
          },
          customId,
        );

        expect(result.id).toBe(customId);

        // Verify database records
        const dbResult = await serverDB.select().from(messages).where(eq(messages.id, customId));
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0].id).toBe(customId);
      });

      it('should create a message with file chunks and RAG query ID', async () => {
        // Create test data following proper order: message -> query -> message with chunks
        const chunkId1 = uuid();
        const chunkId2 = uuid();
        const firstMessageId = uuid();
        const secondMessageId = uuid();

        // 1. Create chunks first
        await serverDB.insert(chunks).values([
          { id: chunkId1, text: 'chunk text 1', userId },
          { id: chunkId2, text: 'chunk text 2', userId },
        ]);

        // 2. Create first message (required for messageQuery FK)
        await serverDB.insert(messages).values({
          id: firstMessageId,
          userId,
          role: 'user',
          content: 'user query',
          sessionId: '1',
        });

        // 3. Create message query linked to first message
        const messageQuery = await messageModel.createMessageQuery({
          messageId: firstMessageId,
          rewriteQuery: 'test query',
          userQuery: 'original query',
          embeddingsId,
        });

        // 4. Create second message with file chunks referencing the query
        const result = await messageModel.create(
          {
            role: 'assistant',
            content: 'message with file chunks',
            fileChunks: [
              { id: chunkId1, similarity: 0.95 },
              { id: chunkId2, similarity: 0.85 },
            ],
            ragQueryId: messageQuery.id,
            sessionId: '1',
          },
          secondMessageId,
        );

        // Verify message created successfully
        expect(result.id).toBe(secondMessageId);

        // Verify message query chunk associations created successfully
        const queryChunks = await serverDB
          .select()
          .from(messageQueryChunks)
          .where(eq(messageQueryChunks.messageId, result.id));

        expect(queryChunks).toHaveLength(2);
        expect(queryChunks[0].chunkId).toBe(chunkId1);
        expect(queryChunks[0].queryId).toBe(messageQuery.id);
        expect(queryChunks[0].similarity).toBe('0.95000');
        expect(queryChunks[1].chunkId).toBe(chunkId2);
        expect(queryChunks[1].similarity).toBe('0.85000');
      });

      it('should create a message with files', async () => {
        // Create test data
        await serverDB.insert(files).values([
          {
            id: 'file1',
            name: 'file1.txt',
            fileType: 'text/plain',
            size: 100,
            url: 'url1',
            userId,
          },
          {
            id: 'file2',
            name: 'file2.jpg',
            fileType: 'image/jpeg',
            size: 200,
            url: 'url2',
            userId,
          },
        ]);

        // Call create method
        const result = await messageModel.create({
          role: 'user',
          content: 'message with files',
          files: ['file1', 'file2'],
          sessionId: '1',
        });

        // Verify message created successfully
        expect(result.id).toBeDefined();

        // Verify message file associations created successfully
        const messageFiles = await serverDB
          .select()
          .from(messagesFiles)
          .where(eq(messagesFiles.messageId, result.id));

        expect(messageFiles).toHaveLength(2);
        expect(messageFiles[0].fileId).toBe('file1');
        expect(messageFiles[1].fileId).toBe('file2');
      });

      it('should create a message with custom timestamps', async () => {
        const customCreatedAt = '2022-05-15T10:30:00Z';
        const customUpdatedAt = '2022-05-16T11:45:00Z';

        const result = await messageModel.create({
          role: 'user',
          content: 'message with custom timestamps',
          createdAt: customCreatedAt as any,
          updatedAt: customUpdatedAt as any,
          sessionId: '1',
        });

        // Verify database records
        const dbResult = await serverDB.select().from(messages).where(eq(messages.id, result.id));

        // Date comparison needs to consider timezone and formatting, so use toISOString for comparison
        expect(new Date(dbResult[0].createdAt!).toISOString()).toBe(
          new Date(customCreatedAt).toISOString(),
        );
        expect(new Date(dbResult[0].updatedAt!).toISOString()).toBe(
          new Date(customUpdatedAt).toISOString(),
        );
      });
    });
  });

  describe('batchCreateMessages', () => {
    it('should batch create messages', async () => {
      // Prepare test data
      const newMessages = [
        { id: '1', role: 'user', content: 'message 1' },
        { id: '2', role: 'assistant', content: 'message 2' },
      ] as DBMessageItem[];

      // Call batchCreateMessages method
      await messageModel.batchCreate(newMessages);

      // Assert result
      const result = await serverDB.select().from(messages).where(eq(messages.userId, userId));
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('message 1');
      expect(result[1].content).toBe('message 2');
    });

    it('should handle messages with and without groupId', async () => {
      await serverDB.insert(sessions).values({ id: 'session1', userId });
      await serverDB.insert(chatGroups).values({ id: 'group1', userId, title: 'Group 1' });

      // Message without groupId - should keep sessionId
      const msgWithoutGroup = await messageModel.create({
        role: 'user',
        content: 'message without group',
        sessionId: 'session1',
      });

      // Message with groupId - sessionId should be set to null
      const msgWithGroup = await messageModel.create({
        role: 'user',
        content: 'message with group',
        sessionId: 'session1',
        groupId: 'group1',
      });

      // Verify from database
      const dbMsgWithoutGroup = await serverDB.query.messages.findFirst({
        where: eq(messages.id, msgWithoutGroup.id),
      });
      const dbMsgWithGroup = await serverDB.query.messages.findFirst({
        where: eq(messages.id, msgWithGroup.id),
      });

      expect(dbMsgWithoutGroup?.sessionId).toBe('session1');
      expect(dbMsgWithoutGroup?.groupId).toBeNull();

      expect(dbMsgWithGroup?.sessionId).toBeNull();
      expect(dbMsgWithGroup?.groupId).toBe('group1');
    });
  });

  describe('createMessageQuery', () => {
    it('should create a new message query', async () => {
      // Create test data
      await serverDB.insert(messages).values({
        id: 'msg1',
        userId,
        role: 'user',
        content: 'test message',
      });

      // 调用 createMessageQuery 方法
      const result = await messageModel.createMessageQuery({
        messageId: 'msg1',
        userQuery: 'original query',
        rewriteQuery: 'rewritten query',
        embeddingsId,
      });

      // Assert result
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.messageId).toBe('msg1');
      expect(result.userQuery).toBe('original query');
      expect(result.rewriteQuery).toBe('rewritten query');
      expect(result.userId).toBe(userId);

      // 验证数据库中的记录
      const dbResult = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, result.id));

      expect(dbResult).toHaveLength(1);
      expect(dbResult[0].messageId).toBe('msg1');
      expect(dbResult[0].userQuery).toBe('original query');
      expect(dbResult[0].rewriteQuery).toBe('rewritten query');
    });

    it('should create a message query with embeddings ID', async () => {
      // Create test data
      await serverDB.insert(messages).values({
        id: 'msg2',
        userId,
        role: 'user',
        content: 'test message',
      });

      // 调用 createMessageQuery 方法
      const result = await messageModel.createMessageQuery({
        messageId: 'msg2',
        userQuery: 'test query',
        rewriteQuery: 'test rewritten query',
        embeddingsId,
      });

      // Assert result
      expect(result).toBeDefined();
      expect(result.embeddingsId).toBe(embeddingsId);

      // 验证数据库中的记录
      const dbResult = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, result.id));

      expect(dbResult[0].embeddingsId).toBe(embeddingsId);
    });

    it('should generate a unique ID for each message query', async () => {
      // Create test data
      await serverDB.insert(messages).values({
        id: 'msg3',
        userId,
        role: 'user',
        content: 'test message',
      });

      // 连续创建两个消息查询
      const result1 = await messageModel.createMessageQuery({
        messageId: 'msg3',
        userQuery: 'query 1',
        rewriteQuery: 'rewritten query 1',
        embeddingsId,
      });

      const result2 = await messageModel.createMessageQuery({
        messageId: 'msg3',
        userQuery: 'query 2',
        rewriteQuery: 'rewritten query 2',
        embeddingsId,
      });

      // Assert result
      expect(result1.id).not.toBe(result2.id);
    });
  });

  describe('updateMessageRAG', () => {
    it('should insert message query chunks for RAG', async () => {
      // prepare message and query
      const messageId = 'rag-msg-1';
      const queryId = uuid();
      const chunk1 = uuid();
      const chunk2 = uuid();

      await serverDB.transaction(async (trx) => {
        await trx.insert(messages).values({ id: messageId, role: 'user', userId, content: 'c' });
        await trx.insert(chunks).values([
          { id: chunk1, text: 'a' },
          { id: chunk2, text: 'b' },
        ]);
        await trx
          .insert(messageQueries)
          .values({ id: queryId, messageId, userId, userQuery: 'q', rewriteQuery: 'rq' });
      });

      await messageModel.updateMessageRAG(messageId, {
        ragQueryId: queryId,
        fileChunks: [
          { id: chunk1, similarity: 0.9 },
          { id: chunk2, similarity: 0.8 },
        ],
      });

      const rows = await serverDB
        .select()
        .from(messageQueryChunks)
        .where(eq(messageQueryChunks.messageId, messageId));

      expect(rows).toHaveLength(2);
      const s1 = rows.find((r) => r.chunkId === chunk1)!;
      const s2 = rows.find((r) => r.chunkId === chunk2)!;
      expect(s1.queryId).toBe(queryId);
      expect(s1.similarity).toBe('0.90000');
      expect(s2.similarity).toBe('0.80000');
    });
  });
});
