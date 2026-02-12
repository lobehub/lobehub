import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ExportedTopic, ImportedMessage } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicImporterRepo } from '../index';

const userId = 'topic-importer-user';
const agentId = 'topic-importer-agent';
let serverDB: LobeChatDatabase;

describe('TopicImporterRepo.importTopic', () => {
  beforeEach(async () => {
    serverDB = await getTestDB();
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }]);
      await tx.insert(agents).values({ id: agentId, userId, title: 'Test Agent' });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('simple format (array without parentId)', () => {
    it('should import messages and build linear parentId chain', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const importData: ImportedMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', role: 'assistant' },
        { content: 'How are you?', role: 'user' },
      ];

      const result = await repo.importTopic({
        agentId,
        data: importData,
      });

      expect(result.messageCount).toBe(3);
      expect(result.topicId).toBeDefined();

      // Verify messages are inserted with linear parentId chain
      const insertedMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result.topicId))
        .orderBy(messages.createdAt);

      expect(insertedMessages.length).toBe(3);
      expect(insertedMessages[0].parentId).toBeNull();
      expect(insertedMessages[1].parentId).toBe(insertedMessages[0].id);
      expect(insertedMessages[2].parentId).toBe(insertedMessages[1].id);
    });
  });

  describe('full format (ExportedTopic with parentId)', () => {
    it('should restore parentId chain from real exported data', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const jsonPath = path.join(__dirname, 'fixtures/exported-topic.json');
      const fileContent = readFileSync(jsonPath, 'utf-8');
      const exportedData = JSON.parse(fileContent) as ExportedTopic;

      const result = await repo.importTopic({
        agentId,
        data: exportedData,
      });

      expect(result.messageCount).toBe(11);

      // Verify topic is created with correct title
      const [insertedTopic] = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.id, result.topicId));

      expect(insertedTopic.title).toBe('简单问候');

      // Verify messages are inserted
      const insertedMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result.topicId))
        .orderBy(messages.createdAt);

      expect(insertedMessages.length).toBe(11);

      // Build id -> message map for verification
      const messageMap = new Map(insertedMessages.map((m) => [m.id, m]));

      // Verify parentId relationships
      // Message 0: root - no parent
      expect(insertedMessages[0].parentId).toBeNull();

      // Messages 1 and 2: both should have message 0 as parent (branching)
      expect(insertedMessages[1].parentId).toBe(insertedMessages[0].id);
      expect(insertedMessages[2].parentId).toBe(insertedMessages[0].id);

      // Message 3: should have message 2 as parent
      expect(insertedMessages[3].parentId).toBe(insertedMessages[2].id);

      // Verify the rest of the chain
      expect(insertedMessages[4].parentId).toBe(insertedMessages[3].id);
      expect(insertedMessages[5].parentId).toBe(insertedMessages[4].id);
      expect(insertedMessages[6].parentId).toBe(insertedMessages[5].id);
      expect(insertedMessages[7].parentId).toBe(insertedMessages[6].id);
      expect(insertedMessages[8].parentId).toBe(insertedMessages[7].id);
      expect(insertedMessages[9].parentId).toBe(insertedMessages[8].id);
      expect(insertedMessages[10].parentId).toBe(insertedMessages[9].id);
    });

    it('should preserve plugin and pluginState fields in message_plugins table', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const jsonPath = path.join(__dirname, 'fixtures/exported-topic.json');
      const fileContent = readFileSync(jsonPath, 'utf-8');
      const exportedData = JSON.parse(fileContent) as ExportedTopic;

      const result = await repo.importTopic({
        agentId,
        data: exportedData,
      });

      // Get tool messages (index 7 and 9 in original data)
      const insertedMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result.topicId))
        .orderBy(messages.createdAt);

      // Find tool messages
      const toolMessages = insertedMessages.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(2);

      // Get plugin records for tool messages
      const pluginRecords = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.userId, userId));

      expect(pluginRecords.length).toBe(2);

      // Find plugin record for first tool message
      const firstPlugin = pluginRecords.find((p) => p.id === toolMessages[0].id);
      expect(firstPlugin).toBeDefined();
      expect(firstPlugin!.apiName).toBe('search');
      expect(firstPlugin!.arguments).toBe('{"query": "杭州天气"}');
      expect(firstPlugin!.identifier).toBe('lobe-web-browsing');
      expect(firstPlugin!.type).toBe('builtin');
      expect(firstPlugin!.toolCallId).toBe('toolu_1');
      expect(firstPlugin!.state).toEqual({
        query: '杭州天气',
        results: [{ title: '杭州天气', content: '多云 3-14℃' }],
      });

      // Find plugin record for second tool message
      const secondPlugin = pluginRecords.find((p) => p.id === toolMessages[1].id);
      expect(secondPlugin).toBeDefined();
      expect(secondPlugin!.apiName).toBe('search');
      expect(secondPlugin!.arguments).toBe('{"query": "杭州天气预报"}');
      expect(secondPlugin!.toolCallId).toBe('toolu_2');
      expect(secondPlugin!.state).toEqual({
        query: '杭州天气预报',
        results: [{ title: '杭州天气预报', content: '明天多云转阴 16℃' }],
      });
    });

    it('should preserve tools array on assistant messages', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const jsonPath = path.join(__dirname, 'fixtures/exported-topic.json');
      const fileContent = readFileSync(jsonPath, 'utf-8');
      const exportedData = JSON.parse(fileContent) as ExportedTopic;

      const result = await repo.importTopic({
        agentId,
        data: exportedData,
      });

      const insertedMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result.topicId))
        .orderBy(messages.createdAt);

      // Find assistant messages with tools (index 6 and 8 in original)
      const assistantWithTools = insertedMessages.filter(
        (m) => m.role === 'assistant' && m.tools && (m.tools as any[]).length > 0,
      );
      expect(assistantWithTools.length).toBe(2);

      expect(assistantWithTools[0].tools).toEqual([
        {
          id: 'toolu_1',
          type: 'builtin',
          apiName: 'search',
          arguments: '{"query": "杭州天气"}',
          identifier: 'lobe-web-browsing',
        },
      ]);
    });

    it('should preserve model and provider fields', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const jsonPath = path.join(__dirname, 'fixtures/exported-topic.json');
      const fileContent = readFileSync(jsonPath, 'utf-8');
      const exportedData = JSON.parse(fileContent) as ExportedTopic;

      const result = await repo.importTopic({
        agentId,
        data: exportedData,
      });

      const insertedMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result.topicId))
        .orderBy(messages.createdAt);

      // Check assistant messages have model and provider
      const assistantMessages = insertedMessages.filter((m) => m.role === 'assistant');
      for (const msg of assistantMessages) {
        expect(msg.model).toBe('claude-sonnet-4-5-20250929');
        expect(msg.provider).toBe('anthropic');
      }
    });

    it('should verify branching is preserved (2 children for root)', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const jsonPath = path.join(__dirname, 'fixtures/exported-topic.json');
      const fileContent = readFileSync(jsonPath, 'utf-8');
      const exportedData = JSON.parse(fileContent) as ExportedTopic;

      const result = await repo.importTopic({
        agentId,
        data: exportedData,
      });

      const insertedMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, result.topicId))
        .orderBy(messages.createdAt);

      const rootId = insertedMessages[0].id;
      const messagesWithRootAsParent = insertedMessages.filter((m) => m.parentId === rootId);

      // Should have 2 children (branching from root)
      expect(messagesWithRootAsParent.length).toBe(2);
    });
  });

  describe('string input', () => {
    it('should accept JSON string as input', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      const importData: ImportedMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi!', role: 'assistant' },
      ];

      const result = await repo.importTopic({
        agentId,
        data: JSON.stringify(importData),
      });

      expect(result.messageCount).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should throw error when no valid messages to import', async () => {
      const repo = new TopicImporterRepo(serverDB, userId);
      // Only system messages - should be filtered out
      const importData: ImportedMessage[] = [{ content: 'System prompt', role: 'system' }];

      await expect(
        repo.importTopic({
          agentId,
          data: importData,
        }),
      ).rejects.toThrow('No valid messages to import');
    });
  });
});
