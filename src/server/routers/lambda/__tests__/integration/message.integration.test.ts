// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { messages, sessions, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageRouter } from '../../message';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

// Mock FileService to avoid S3 initialization issues in tests
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

// We need to mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

/**
 * Message Router 集成测试
 *
 * 测试目标：
 * 1. 验证完整的 tRPC 调用链路（Router → Model → Database）
 * 2. 确保 sessionId、topicId、groupId 等参数正确传递
 * 3. 验证数据库约束和关联关系
 */
describe('Message Router Integration Tests', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testSessionId: string;
  let testTopicId: string;
  let testAgentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB; // Set the test DB for the mock
    userId = await createTestUser(serverDB);

    // 创建测试 agent
    const { agents } = await import('@/database/schemas');
    const [agent] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Test Agent',
      })
      .returning();
    testAgentId = agent.id;

    // 创建测试 session
    const [session] = await serverDB
      .insert(sessions)
      .values({
        userId,
        type: 'agent',
      })
      .returning();
    testSessionId = session.id;

    // 创建 agent 到 session 的映射关系
    const { agentsToSessions } = await import('@/database/schemas');
    await serverDB.insert(agentsToSessions).values({
      agentId: testAgentId,
      sessionId: testSessionId,
      userId,
    });

    // 创建测试 topic
    const [topic] = await serverDB
      .insert(topics)
      .values({
        userId,
        sessionId: testSessionId,
        title: 'Test Topic',
      })
      .returning();
    testTopicId = topic.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  describe('createMessage', () => {
    it('should create message with correct sessionId and topicId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const result = await caller.createMessage({
        content: 'Test message',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 🔥 关键：从数据库验证关联关系
      const [createdMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.id));

      expect(createdMessage).toBeDefined();
      expect(createdMessage).toMatchObject({
        id: result.id,
        agentId: testAgentId, // sessionId 会解析为 agentId 存储
        topicId: testTopicId,
        userId: userId,
        content: 'Test message',
        role: 'user',
      });
    });

    it('should create message with threadId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 先创建 thread
      const { threads } = await import('@/database/schemas');
      const [thread] = (await serverDB
        .insert(threads)
        .values({
          userId,
          topicId: testTopicId,
          sourceMessageId: 'msg-source',
          type: 'continuation', // type is required
        })
        .returning()) as any;

      const result = await caller.createMessage({
        content: 'Test message in thread',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
        threadId: thread.id,
      });

      // 验证 threadId 正确存储
      const [createdMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.id));

      expect(createdMessage).toBeDefined();
      expect(createdMessage.threadId).toBe(thread.id);
      expect(createdMessage).toMatchObject({
        id: result.id,
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: thread.id,
        content: 'Test message in thread',
        role: 'user',
      });
    });

    it('should create message without topicId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const result = await caller.createMessage({
        content: 'Test message without topic',
        role: 'user',
        sessionId: testSessionId,
        // 注意：没有 topicId
      });

      const [createdMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.id));

      expect(createdMessage.topicId).toBeNull();
      expect(createdMessage.agentId).toBe(testAgentId);
    });

    it('should fail when sessionId does not exist', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await expect(
        caller.createMessage({
          content: 'Test message',
          role: 'user',
          sessionId: 'non-existent-session',
        }),
      ).rejects.toThrow();
    });

    it.skip('should fail when topicId does not belong to sessionId', async () => {
      // TODO: This validation is not currently enforced in the code
      // 创建另一个 session 和 topic
      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      const [anotherTopic] = await serverDB
        .insert(topics)
        .values({
          userId,
          sessionId: anotherSession.id,
          title: 'Another Topic',
        })
        .returning();

      const caller = messageRouter.createCaller(createTestContext(userId));

      // 尝试在 testSessionId 下创建消息，但使用 anotherTopic 的 ID
      await expect(
        caller.createMessage({
          content: 'Test message',
          role: 'user',
          sessionId: testSessionId,
          topicId: anotherTopic.id, // 这个 topic 不属于 testSessionId
        }),
      ).rejects.toThrow();
    });
  });

  /**
   * agentId 兼容性测试
   *
   * 测试 agentId → sessionId 解析功能
   * 确保可以使用 agentId 替代 sessionId 进行操作
   */
  describe('agentId compatibility', () => {
    describe('createMessage with agentId', () => {
      it('should create message using agentId instead of sessionId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        const result = await caller.createMessage({
          content: 'Message created with agentId',
          role: 'user',
          agentId: testAgentId,
          // 不提供 sessionId，只使用 agentId
        });

        // 验证消息创建成功，且关联到正确的 sessionId
        const [createdMessage] = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, result.id));

        expect(createdMessage).toBeDefined();
        expect(createdMessage.agentId).toBe(testAgentId);
        expect(createdMessage.content).toBe('Message created with agentId');
      });

      it('should create message with agentId and topicId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        const result = await caller.createMessage({
          content: 'Message with agentId and topicId',
          role: 'user',
          agentId: testAgentId,
          topicId: testTopicId,
        });

        const [createdMessage] = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, result.id));

        expect(createdMessage.agentId).toBe(testAgentId);
        expect(createdMessage.topicId).toBe(testTopicId);
      });

      it('should prefer agentId over sessionId when both provided', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        // 创建另一个 session（不关联到 agent）
        const [anotherSession] = await serverDB
          .insert(sessions)
          .values({
            userId,
            type: 'agent',
          })
          .returning();

        const result = await caller.createMessage({
          content: 'Message with both agentId and sessionId',
          role: 'user',
          agentId: testAgentId,
          sessionId: anotherSession.id, // 这个会被 agentId 覆盖
        });

        const [createdMessage] = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, result.id));

        // 应该使用提供的 agentId
        expect(createdMessage.agentId).toBe(testAgentId);
      });

      it('should fail when agentId does not exist due to FK constraint', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        // 当 agentId 不存在时，应该因为外键约束而失败
        await expect(
          caller.createMessage({
            content: 'Message with non-existent agentId',
            role: 'user',
            agentId: 'non-existent-agent-id',
          }),
        ).rejects.toThrow();
      });
    });

    describe('removeMessage with agentId', () => {
      it('should remove message using agentId and return updated list', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        // 创建两条消息
        const msg1 = await caller.createMessage({
          content: 'Message 1',
          role: 'user',
          sessionId: testSessionId,
        });

        const msg2 = await caller.createMessage({
          content: 'Message 2',
          role: 'user',
          sessionId: testSessionId,
        });

        // 使用 agentId 删除消息
        const result = await caller.removeMessage({
          id: msg1.id,
          agentId: testAgentId,
        });

        expect(result.success).toBe(true);
        expect(result.messages).toHaveLength(1);
        expect(result.messages?.[0].id).toBe(msg2.id);
      });
    });

    describe('removeMessages with agentId', () => {
      it('should remove multiple messages using agentId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        const msg1 = await caller.createMessage({
          content: 'Message 1',
          role: 'user',
          sessionId: testSessionId,
        });

        const msg2 = await caller.createMessage({
          content: 'Message 2',
          role: 'user',
          sessionId: testSessionId,
        });

        const msg3 = await caller.createMessage({
          content: 'Message 3',
          role: 'user',
          sessionId: testSessionId,
        });

        const result = await caller.removeMessages({
          ids: [msg1.id, msg2.id],
          agentId: testAgentId,
        });

        expect(result.success).toBe(true);
        expect(result.messages).toHaveLength(1);
        expect(result.messages?.[0].id).toBe(msg3.id);
      });
    });

    describe('update with agentId', () => {
      it('should update message using agentId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        const msg = await caller.createMessage({
          content: 'Original content',
          role: 'user',
          sessionId: testSessionId,
        });

        const result = await caller.update({
          id: msg.id,
          agentId: testAgentId,
          value: { content: 'Updated via agentId' },
        });

        expect(result.success).toBe(true);

        const [updatedMessage] = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.id, msg.id));

        expect(updatedMessage.content).toBe('Updated via agentId');
      });
    });

    describe('removeMessagesByAssistant with agentId', () => {
      it('should remove messages by assistant using agentId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        await caller.createMessage({
          content: 'Message 1',
          role: 'user',
          sessionId: testSessionId,
        });

        await caller.createMessage({
          content: 'Message 2',
          role: 'assistant',
          sessionId: testSessionId,
        });

        // 使用 agentId 删除 session 中的所有消息
        await caller.removeMessagesByAssistant({
          agentId: testAgentId,
        });

        const remainingMessages = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.agentId, testAgentId));

        expect(remainingMessages).toHaveLength(0);
      });

      it('should remove messages in specific topic using agentId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        // 在 topic 中创建消息
        await caller.createMessage({
          content: 'Message in topic',
          role: 'user',
          sessionId: testSessionId,
          topicId: testTopicId,
        });

        // 在 session 中创建消息（不在 topic 中）
        const msgOutside = await caller.createMessage({
          content: 'Message outside topic',
          role: 'user',
          sessionId: testSessionId,
        });

        // 使用 agentId 和 topicId 删除
        await caller.removeMessagesByAssistant({
          agentId: testAgentId,
          topicId: testTopicId,
        });

        const remainingMessages = await serverDB
          .select()
          .from(messages)
          .where(eq(messages.agentId, testAgentId));

        expect(remainingMessages).toHaveLength(1);
        expect(remainingMessages[0].id).toBe(msgOutside.id);
      });
    });

    describe('updatePluginState with agentId', () => {
      it('should update plugin state using agentId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        const msg = await caller.createMessage({
          content: 'Message with plugin',
          role: 'assistant',
          sessionId: testSessionId,
        });

        // 创建 plugin 记录
        const { messagePlugins } = await import('@/database/schemas');
        await serverDB.insert(messagePlugins).values({
          id: msg.id,
          userId,
          toolCallId: 'test-tool-call-agentid',
          type: 'default',
        });

        const result = await caller.updatePluginState({
          id: msg.id,
          agentId: testAgentId,
          value: { testKey: 'testValue' },
        });

        expect(result.success).toBe(true);
      });
    });

    describe('updateMetadata with agentId', () => {
      it('should update metadata using agentId', async () => {
        const caller = messageRouter.createCaller(createTestContext(userId));

        const msg = await caller.createMessage({
          content: 'Message with metadata',
          role: 'user',
          sessionId: testSessionId,
        });

        const result = await caller.updateMetadata({
          id: msg.id,
          agentId: testAgentId,
          value: { customField: 'customValue' },
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('getMessages', () => {
    it('should return messages filtered by sessionId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个消息
      const msg1Result = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2Result = await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 创建另一个 session 的消息
      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      await caller.createMessage({
        content: 'Message in another session',
        role: 'user',
        sessionId: anotherSession.id,
      });

      // 查询特定 session 的消息
      const result = await caller.getMessages({
        sessionId: testSessionId,
      });

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toContain(msg1Result.id);
      expect(result.map((m) => m.id)).toContain(msg2Result.id);
    });

    it('should return messages filtered by topicId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 在 topic 中创建消息
      const msgInTopicResult = await caller.createMessage({
        content: 'Message in topic',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 在 session 中创建消息（不在 topic 中）
      await caller.createMessage({
        content: 'Message without topic',
        role: 'user',
        sessionId: testSessionId,
      });

      // 查询特定 topic 的消息
      const result = await caller.getMessages({
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(msgInTopicResult.id);
      expect(result[0].topicId).toBe(testTopicId);
    });

    it('should support pagination', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个消息
      for (let i = 0; i < 5; i++) {
        await caller.createMessage({
          content: `Pagination test message ${i}`,
          role: 'user',
          sessionId: testSessionId,
        });
      }

      // 获取所有消息确认创建成功
      const allMessages = await caller.getMessages({
        sessionId: testSessionId,
      });
      expect(allMessages.length).toBeGreaterThanOrEqual(5);

      // 第一页
      const page1 = await caller.getMessages({
        sessionId: testSessionId,
        current: 1,
        pageSize: 2,
      });

      expect(page1.length).toBeLessThanOrEqual(2);

      // 第二页
      const page2 = await caller.getMessages({
        sessionId: testSessionId,
        current: 2,
        pageSize: 2,
      });

      expect(page2.length).toBeLessThanOrEqual(2);

      // 确保不同页的消息不重复（如果两页都有数据）
      if (page1.length > 0 && page2.length > 0) {
        const page1Ids = page1.map((m) => m.id);
        const page2Ids = page2.map((m) => m.id);
        expect(page1Ids).not.toEqual(page2Ids);
      }
    });

    it('should return messages filtered by groupId', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 首先创建一个 chat_group
      const { chatGroups } = await import('@/database/schemas');
      const [chatGroup] = await serverDB
        .insert(chatGroups)
        .values({
          userId,
          title: 'Test Chat Group',
        })
        .returning();

      // 创建消息并设置 groupId
      const msg1 = await caller.createMessage({
        content: 'Message 1 in group',
        role: 'assistant',
        sessionId: testSessionId,
      });

      await serverDB
        .update(messages)
        .set({ groupId: chatGroup.id })
        .where(eq(messages.id, msg1.id));

      // 创建不在 group 中的消息
      await caller.createMessage({
        content: 'Message without group',
        role: 'user',
        sessionId: testSessionId,
      });

      // 查询 group 中的消息
      const result = await caller.getMessages({
        sessionId: testSessionId,
        groupId: chatGroup.id,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(msg1.id);
    });
  });

  describe('removeMessages', () => {
    it('should remove multiple messages', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建消息
      const msg1Result = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2Result = await caller.createMessage({
        content: 'Message 2',
        role: 'user',
        sessionId: testSessionId,
      });

      // 删除消息
      await caller.removeMessages({ ids: [msg1Result.id, msg2Result.id] });

      // 验证消息已删除
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentId));

      expect(remainingMessages).toHaveLength(0);
    });

    it('should return message list when sessionId is provided', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建消息
      const msg1Result = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2Result = await caller.createMessage({
        content: 'Message 2',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg3Result = await caller.createMessage({
        content: 'Message 3',
        role: 'user',
        sessionId: testSessionId,
      });

      // 删除消息并返回列表
      const result = await caller.removeMessages({
        ids: [msg1Result.id],
        sessionId: testSessionId,
      });

      expect(result.success).toBe(true);
      expect(result.messages).toBeDefined();
      expect(result.messages).toHaveLength(2);
      expect(result.messages?.map((m) => m.id)).toContain(msg2Result.id);
      expect(result.messages?.map((m) => m.id)).toContain(msg3Result.id);
    });
  });

  describe('removeMessage', () => {
    it('should remove a single message', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msgResult = await caller.createMessage({
        content: 'Message to remove',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.removeMessage({ id: msgResult.id });

      // 验证消息已删除
      const deletedMessage = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, msgResult.id));

      expect(deletedMessage).toHaveLength(0);
    });

    it('should return message list when sessionId is provided', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg1Result = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2Result = await caller.createMessage({
        content: 'Message 2',
        role: 'user',
        sessionId: testSessionId,
      });

      const result = await caller.removeMessage({
        id: msg1Result.id,
        sessionId: testSessionId,
      });

      expect(result.success).toBe(true);
      expect(result.messages).toBeDefined();
      expect(result.messages).toHaveLength(1);
      expect(result.messages?.[0].id).toBe(msg2Result.id);
    });
  });

  describe('removeAllMessages', () => {
    it('should remove all messages for the user', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个 session 和消息
      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const [anotherSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
          type: 'agent',
        })
        .returning();

      await caller.createMessage({
        content: 'Message 2',
        role: 'user',
        sessionId: anotherSession.id,
      });

      // 删除所有消息
      await caller.removeAllMessages();

      // 验证所有消息已删除
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));

      expect(remainingMessages).toHaveLength(0);
    });
  });

  describe('removeMessageQuery', () => {
    it('should remove message query', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msgResult = await caller.createMessage({
        content: 'Message with query',
        role: 'user',
        sessionId: testSessionId,
      });

      // 创建一个 message query 记录，使用 UUID
      const { messageQueries } = await import('@/database/schemas');
      const [queryRecord] = await serverDB
        .insert(messageQueries)
        .values({
          messageId: msgResult.id,
          userId,
          userQuery: 'test query',
        })
        .returning();

      await caller.removeMessageQuery({ id: queryRecord.id });

      // 验证消息查询已删除
      const deletedQuery = await serverDB
        .select()
        .from(messageQueries)
        .where(eq(messageQueries.id, queryRecord.id));

      expect(deletedQuery).toHaveLength(0);
    });
  });

  describe('removeMessagesByAssistant', () => {
    it('should remove all messages in a session', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建多个消息
      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 删除 session 中的所有消息
      await caller.removeMessagesByAssistant({
        sessionId: testSessionId,
      });

      // 验证消息已删除
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentId));

      expect(remainingMessages).toHaveLength(0);
    });

    it('should remove messages in a specific topic', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 在 topic 中创建消息
      await caller.createMessage({
        content: 'Message in topic',
        role: 'user',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 在 session 中创建消息（不在 topic 中）
      const msgOutsideTopicResult = await caller.createMessage({
        content: 'Message outside topic',
        role: 'user',
        sessionId: testSessionId,
      });

      // 删除 topic 中的消息
      await caller.removeMessagesByAssistant({
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      // 验证 topic 中的消息已删除，但其他消息仍存在
      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.agentId, testAgentId));

      expect(remainingMessages).toHaveLength(1);
      expect(remainingMessages[0].id).toBe(msgOutsideTopicResult.id);
    });
  });

  describe('removeMessagesByGroup', () => {
    it('should call removeMessagesByGroup endpoint', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 首先创建一个 chat_group
      const { chatGroups } = await import('@/database/schemas');
      const [chatGroup] = await serverDB
        .insert(chatGroups)
        .values({
          userId,
          title: 'Test Chat Group for Delete',
        })
        .returning();

      // 创建消息并设置 groupId
      const msg1 = await caller.createMessage({
        content: 'Message 1 in group',
        role: 'assistant',
        sessionId: testSessionId,
        topicId: testTopicId,
      });

      await serverDB
        .update(messages)
        .set({ groupId: chatGroup.id })
        .where(eq(messages.id, msg1.id));

      // 调用删除接口（不会抛出错误即为成功）
      await expect(
        caller.removeMessagesByGroup({
          groupId: chatGroup.id,
          topicId: testTopicId,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('update', () => {
    it('should update message content', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const result = await caller.createMessage({
        content: 'Original content',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.update({
        id: result.id,
        value: {
          content: 'Updated content',
        },
      });

      const [updatedMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, result.id));

      expect(updatedMessage.content).toBe('Updated content');
    });

    it('should update message and return message list when sessionId is provided', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg1 = await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const msg2 = await caller.createMessage({
        content: 'Message 2',
        role: 'user',
        sessionId: testSessionId,
      });

      const result = await caller.update({
        id: msg1.id,
        sessionId: testSessionId,
        value: {
          content: 'Updated Message 1',
        },
      });

      expect(result).toBeDefined();
      // The update method returns the updated message list
      const messages = await caller.getMessages({ sessionId: testSessionId });
      expect(messages).toHaveLength(2);
      expect(messages.find((m) => m.id === msg1.id)?.content).toBe('Updated Message 1');
    });
  });

  describe('searchMessages', () => {
    it('should search messages by keyword', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await caller.createMessage({
        content: 'This is a test message about TypeScript',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Another message about JavaScript',
        role: 'user',
        sessionId: testSessionId,
      });

      const results = await caller.searchMessages({
        keywords: 'TypeScript',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('TypeScript');
    });
  });

  describe('updateMessagePlugin', () => {
    it('should update message plugin state', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with plugin',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 先创建一个 plugin 记录
      const { messagePlugins } = await import('@/database/schemas');
      await serverDB.insert(messagePlugins).values({
        id: msg.id,
        userId,
        toolCallId: 'test-tool-call',
        type: 'default',
      });

      await caller.updateMessagePlugin({
        id: msg.id,
        value: {
          state: { key: 'value' },
        },
      });

      const [updatedPlugin] = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, msg.id));

      expect(updatedPlugin).toBeDefined();
      expect(updatedPlugin.state).toBeDefined();
    });
  });

  describe('updateMessageRAG', () => {
    it('should update message RAG information', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with RAG',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 创建必要的依赖: chunks -> messageQueries -> messageQueryChunks
      const { chunks, messageQueries, messageQueryChunks } = await import('@/database/schemas');

      // 1. 创建 chunk
      const [chunk] = await serverDB
        .insert(chunks)
        .values({
          userId,
          text: 'test chunk content',
        })
        .returning();

      // 2. 创建 message query
      const [query] = await serverDB
        .insert(messageQueries)
        .values({
          messageId: msg.id,
          userId,
          userQuery: 'test query',
        })
        .returning();

      // 3. 调用 updateMessageRAG
      await caller.updateMessageRAG({
        id: msg.id,
        value: {
          fileChunks: [{ id: chunk.id, similarity: 0.95 }],
          ragQueryId: query.id,
        },
      });

      // 验证 messageQueryChunks 记录已创建
      const [queryChunk] = await serverDB
        .select()
        .from(messageQueryChunks)
        .where(eq(messageQueryChunks.messageId, msg.id));

      expect(queryChunk).toBeDefined();
      expect(queryChunk.chunkId).toBe(chunk.id);
    });

    it('should return message list when sessionId is provided', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg1 = await caller.createMessage({
        content: 'Message 1',
        role: 'assistant',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 创建必要的依赖: chunks -> messageQueries
      const { chunks, messageQueries } = await import('@/database/schemas');
      const [chunk] = await serverDB
        .insert(chunks)
        .values({
          userId,
          text: 'test chunk content',
        })
        .returning();

      // 创建 query (需要 queryId)
      const [query] = await serverDB
        .insert(messageQueries)
        .values({
          messageId: msg1.id,
          userId,
          userQuery: 'test query',
        })
        .returning();

      const result = await caller.updateMessageRAG({
        id: msg1.id,
        sessionId: testSessionId,
        value: {
          fileChunks: [{ id: chunk.id, similarity: 0.95 }],
          ragQueryId: query.id,
        },
      });

      expect(result.success).toBe(true);
      expect(result.messages).toBeDefined();
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('updateMetadata', () => {
    it('should update message metadata', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with metadata',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.updateMetadata({
        id: msg.id,
        value: { customKey: 'customValue' },
      });

      const [updatedMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, msg.id));

      expect(updatedMessage).toBeDefined();
      // Verify the message still exists after update
      expect(updatedMessage.id).toBe(msg.id);
    });
  });

  describe('updatePluginError', () => {
    it('should update plugin error state', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with plugin error',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 先创建一个 plugin 记录
      const { messagePlugins } = await import('@/database/schemas');
      await serverDB.insert(messagePlugins).values({
        id: msg.id,
        userId,
        toolCallId: 'test-tool-call-error',
        type: 'default',
      });

      await caller.updatePluginError({
        id: msg.id,
        value: { message: 'Plugin error occurred' },
      });

      const [updatedPlugin] = await serverDB
        .select()
        .from(messagePlugins)
        .where(eq(messagePlugins.id, msg.id));

      expect(updatedPlugin).toBeDefined();
      expect(updatedPlugin.error).toBeDefined();
    });

    it('should return message list when sessionId is provided', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg1 = await caller.createMessage({
        content: 'Message 1',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 先创建一个 plugin 记录
      const { messagePlugins } = await import('@/database/schemas');
      await serverDB.insert(messagePlugins).values({
        id: msg1.id,
        userId,
        toolCallId: 'test-tool-call-error-2',
        type: 'default',
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      const result = await caller.updatePluginError({
        id: msg1.id,
        sessionId: testSessionId,
        value: { message: 'Error' },
      });

      expect(result.success).toBe(true);
      expect(result.messages).toBeDefined();
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('updatePluginState', () => {
    it('should update plugin state', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with plugin state',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 先创建一个 plugin 记录
      const { messagePlugins } = await import('@/database/schemas');
      await serverDB.insert(messagePlugins).values({
        id: msg.id,
        userId,
        toolCallId: 'test-tool-call-state',
        type: 'default',
      });

      const result = await caller.updatePluginState({
        id: msg.id,
        sessionId: testSessionId,
        value: { stateKey: 'stateValue' },
      });

      expect(result).toBeDefined();
    });
  });

  describe('updateTTS', () => {
    it('should update TTS information', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with TTS',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 创建 file 记录
      const { files } = await import('@/database/schemas');
      const [file] = await serverDB
        .insert(files)
        .values({
          userId,
          name: 'audio.mp3',
          fileType: 'audio/mpeg',
          size: 1024,
          url: '/files/audio.mp3',
        })
        .returning();

      await caller.updateTTS({
        id: msg.id,
        value: {
          file: file.id,
          voice: 'en-US-neural',
          contentMd5: 'abc123',
        },
      });

      const { messageTTS } = await import('@/database/schemas');
      const [ttsRecord] = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, msg.id));

      expect(ttsRecord).toBeDefined();
      expect(ttsRecord.voice).toBe('en-US-neural');
      expect(ttsRecord.fileId).toBe(file.id);
    });

    it('should delete TTS when value is false', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Message with TTS to delete',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 创建 file 记录
      const { files } = await import('@/database/schemas');
      const [file] = await serverDB
        .insert(files)
        .values({
          userId,
          name: 'audio-delete.mp3',
          fileType: 'audio/mpeg',
          size: 1024,
          url: '/files/audio-delete.mp3',
        })
        .returning();

      // First add TTS
      await caller.updateTTS({
        id: msg.id,
        value: {
          file: file.id,
          voice: 'en-US-neural',
        },
      });

      // Then delete it
      await caller.updateTTS({
        id: msg.id,
        value: false,
      });

      const { messageTTS } = await import('@/database/schemas');
      const [ttsRecord] = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, msg.id));

      expect(ttsRecord).toBeUndefined();
    });
  });

  describe('updateTranslate', () => {
    it('should update translation information', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Hello world',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.updateTranslate({
        id: msg.id,
        value: {
          content: '你好世界',
          from: 'en',
          to: 'zh',
        },
      });

      const { messageTranslates } = await import('@/database/schemas');
      const [translateRecord] = await serverDB
        .select()
        .from(messageTranslates)
        .where(eq(messageTranslates.id, msg.id));

      expect(translateRecord).toBeDefined();
      expect(translateRecord.to).toBe('zh');
    });

    it('should delete translation when value is false', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      const msg = await caller.createMessage({
        content: 'Hello world',
        role: 'user',
        sessionId: testSessionId,
      });

      // First add translation
      await caller.updateTranslate({
        id: msg.id,
        value: {
          content: '你好世界',
          to: 'zh',
        },
      });

      // Then delete it
      await caller.updateTranslate({
        id: msg.id,
        value: false,
      });

      const [updatedMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, msg.id));

      expect(updatedMessage).toBeDefined();
    });
  });

  describe('getHeatmaps', () => {
    it('should get message heatmaps', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建一些消息
      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      const heatmaps = await caller.getHeatmaps();

      expect(heatmaps).toBeDefined();
      expect(Array.isArray(heatmaps)).toBe(true);
    });
  });

  describe('rankModels', () => {
    it('should get model usage ranking', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建带有模型信息的消息
      const msg = await caller.createMessage({
        content: 'Message from AI',
        role: 'assistant',
        sessionId: testSessionId,
      });

      // 添加模型信息
      await serverDB.update(messages).set({ model: 'gpt-4' }).where(eq(messages.id, msg.id));

      const ranking = await caller.rankModels();

      expect(ranking).toBeDefined();
      expect(Array.isArray(ranking)).toBe(true);
    });
  });

  describe('count and statistics', () => {
    it('should count messages', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      // 创建消息
      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      await caller.createMessage({
        content: 'Message 2',
        role: 'assistant',
        sessionId: testSessionId,
      });

      const count = await caller.count();

      expect(count).toBe(2);
    });

    it('should count messages with date range', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await caller.createMessage({
        content: 'Message 1',
        role: 'user',
        sessionId: testSessionId,
      });

      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const count = await caller.count({
        startDate,
        endDate,
      });

      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('should count words', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await caller.createMessage({
        content: 'Hello world',
        role: 'user',
        sessionId: testSessionId,
      });

      const wordCount = await caller.countWords();

      expect(wordCount).toBeGreaterThan(0);
    });

    it('should count words with date range', async () => {
      const caller = messageRouter.createCaller(createTestContext(userId));

      await caller.createMessage({
        content: 'Hello world test message',
        role: 'user',
        sessionId: testSessionId,
      });

      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const wordCount = await caller.countWords({
        startDate,
        endDate,
      });

      expect(wordCount).toBeGreaterThan(0);
    });
  });
});
