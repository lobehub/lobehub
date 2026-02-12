// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, agentsToSessions, sessions, threads, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock AgentRuntimeService since we only want to test the router's business logic
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: vi.fn().mockResolvedValue({
      success: true,
      operationId: 'mock-operation-id',
      autoStarted: true,
      messageId: 'mock-message-id',
    }),
  })),
}));

// Mock serverMessagesEngine
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn(() => ({
    generateToolsDetailed: vi.fn(() => ({ tools: [] })),
    getEnabledPluginManifests: vi.fn(() => new Map()),
  })),
  serverMessagesEngine: vi.fn().mockResolvedValue([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ]),
}));

// Mock AiChatService to avoid S3 dependency
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({
    getMessagesAndTopics: vi.fn().mockResolvedValue({ messages: [], topics: [] }),
  })),
}));

// Mock model-bank with dynamic import to preserve other exports
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof import('model-bank')>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        abilities: { functionCall: true, vision: true, video: false },
      },
    ],
  };
});

/**
 * AI Agent Router 集成测试
 *
 * 测试目标：
 * 1. 验证 execAgent 的业务逻辑
 * 2. 确保 topic 创建逻辑正确
 * 3. 验证与数据库的交互
 */
describe('AI Agent Router Integration Tests', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;
  let testSessionId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);

    // 创建测试 agent
    const [agent] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Test Agent',
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
      })
      .returning();
    testAgentId = agent.id;

    // 创建测试 session
    const [session] = await serverDB.insert(sessions).values({ userId, type: 'agent' }).returning();
    testSessionId = session.id;

    // 创建 agent 到 session 的映射关系
    await serverDB.insert(agentsToSessions).values({
      agentId: testAgentId,
      sessionId: testSessionId,
      userId,
    });
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createTestContext = () => ({
    userId,
    jwtPayload: { userId },
  });

  describe('execAgent', () => {
    it('should create a new topic when topicId is not provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Hello, how are you?',
      });

      expect(result.success).toBe(true);
      expect(result.operationId).toBeDefined();

      // Verify a topic was created
      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.agentId, testAgentId));

      expect(createdTopics).toHaveLength(1);
      expect(createdTopics[0].title).toBe('Hello, how are you?');
    });

    it('should truncate long prompt for topic title', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());
      const longPrompt =
        'This is a very long prompt that exceeds fifty characters and should be truncated';

      await caller.execAgent({
        agentId: testAgentId,
        prompt: longPrompt,
      });

      const createdTopics = await serverDB
        .select()
        .from(topics)
        .where(eq(topics.agentId, testAgentId));

      expect(createdTopics).toHaveLength(1);
      // Title should be first 50 characters + '...'
      expect(createdTopics[0].title).toBe(longPrompt.slice(0, 50) + '...');
      expect(createdTopics[0].title!.length).toBeLessThanOrEqual(53); // 50 + '...'
    });

    it('should reuse existing topic when topicId is provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      // Create an existing topic
      const [existingTopic] = await serverDB
        .insert(topics)
        .values({
          title: 'Existing Topic',
          agentId: testAgentId,
          sessionId: testSessionId,
          userId,
        })
        .returning();

      const result = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Follow up question',
        appContext: {
          topicId: existingTopic.id,
        },
      });

      expect(result.success).toBe(true);

      // Verify no new topic was created
      const allTopics = await serverDB.select().from(topics).where(eq(topics.agentId, testAgentId));

      expect(allTopics).toHaveLength(1);
      expect(allTopics[0].id).toBe(existingTopic.id);
    });

    it('should throw error when agent does not exist', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      // When agent doesn't exist, getAgentConfigById returns null,
      // which triggers NOT_FOUND error before topic creation
      await expect(
        caller.execAgent({
          agentId: 'non-existent-agent-id',
          prompt: 'Hello',
        }),
      ).rejects.toThrow();
    });

    it('should pass correct parameters to createOperation', async () => {
      const { AgentRuntimeService } = await import('@/server/services/agentRuntime');
      const mockCreateOperation = vi.fn().mockResolvedValue({
        success: true,
        operationId: 'test-op-id',
        autoStarted: true,
        messageId: 'test-msg-id',
      });

      vi.mocked(AgentRuntimeService).mockImplementation(
        () =>
          ({
            createOperation: mockCreateOperation,
          }) as any,
      );

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Test prompt',
        autoStart: false,
      });

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          agentConfig: expect.objectContaining({
            model: 'gpt-4o-mini',
            provider: 'openai',
          }),
          appContext: expect.objectContaining({
            agentId: testAgentId,
          }),
          autoStart: false,
          modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
          userId,
        }),
      );
    });

    it('should handle autoStart=true by default', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Hello',
      });

      expect(result.autoStarted).toBe(true);
    });

    it('should include threadId in appContext when provided', async () => {
      const { AgentRuntimeService } = await import('@/server/services/agentRuntime');
      const mockCreateOperation = vi.fn().mockResolvedValue({
        success: true,
        operationId: 'test-op-id',
        autoStarted: true,
        messageId: 'test-msg-id',
      });

      vi.mocked(AgentRuntimeService).mockImplementation(
        () =>
          ({
            createOperation: mockCreateOperation,
          }) as any,
      );

      // Create a topic first (required for thread)
      const [topic] = await serverDB
        .insert(topics)
        .values({
          title: 'Test Topic',
          agentId: testAgentId,
          sessionId: testSessionId,
          userId,
        })
        .returning();

      // Create a thread (required by foreign key constraint on messages)
      const [thread] = (await serverDB
        .insert(threads)
        .values({
          topicId: topic.id,
          agentId: testAgentId,
          userId,
          type: 'isolation',
        })
        .returning()) as any[];

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.execAgent({
        agentId: testAgentId,
        prompt: 'Test prompt',
        appContext: {
          threadId: thread.id,
          topicId: topic.id,
        },
      });

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          appContext: expect.objectContaining({
            threadId: thread.id,
          }),
        }),
      );
    });
  });
});
