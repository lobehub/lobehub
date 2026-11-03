// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, sessions, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

// Mock AiAgentService
const mockExecGroupSubAgentTask = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      execSubAgent: mockExecGroupSubAgentTask,
    };
  }),
}));

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

// Mock AiChatService
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

describe('aiAgentRouter.execSubAgentTask', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;
  let testGroupId: string;
  let testTopicId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);

    // Create test agent
    const [agent] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Test SubAgent',
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
      })
      .returning();
    testAgentId = agent.id;

    // Create test session
    const [session] = await serverDB.insert(sessions).values({ userId, type: 'group' }).returning();

    // Create test group
    const [group] = await serverDB
      .insert(chatGroups)
      .values({
        userId,
        title: 'Test Group',
      })
      .returning();
    testGroupId = group.id;

    // Create test topic
    const [topic] = await serverDB
      .insert(topics)
      .values({
        userId,
        title: 'Test Topic',
        agentId: testAgentId,
        sessionId: session.id,
        groupId: testGroupId,
      })
      .returning();
    testTopicId = topic.id;

    // Reset mock
    mockExecGroupSubAgentTask.mockReset();
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createTestContext = () => ({
    userId,
    jwtPayload: { userId },
  });

  describe('successful execution', () => {
    it('should call service method with correct parameters', async () => {
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-1',
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: testTopicId,
      });

      expect(mockExecGroupSubAgentTask).toHaveBeenCalledWith(
        {
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          timeout: undefined,
          title: undefined,
          topicId: testTopicId,
        },
        { llmRelay: undefined },
      );
    });

    it('hands the tab relay channel and executor to the service', async () => {
      mockExecGroupSubAgentTask.mockResolvedValue({ success: true, threadId: 'thread-123' });
      const llmExecutor = {
        capabilities: ['llm_relay@1'],
        clientId: 'tab-1',
        providers: ['ollama'],
      };
      const channel = `llmcall:${userId}:personal-3f2a9c1d8e7b4a60`;

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.execSubAgentTask({
        agentId: testAgentId,
        instruction: 'Test instruction',
        llmExecutor: { ...llmExecutor, channelOperationId: 'someone-else-op' } as any,
        llmRelayChannel: channel,
        parentMessageId: 'parent-msg-1',
        topicId: testTopicId,
      });

      // A client cannot pick the channel through the executor itself.
      expect(mockExecGroupSubAgentTask).toHaveBeenCalledWith(expect.anything(), {
        llmRelay: { channel, executor: llmExecutor },
      });
    });

    it('should pass parent operation metadata to the service', async () => {
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-1',
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });
      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        parentOperationId: 'parent-operation-1',
        title: 'Delegated task',
        topicId: testTopicId,
      });

      expect(mockExecGroupSubAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          parentOperationId: 'parent-operation-1',
          title: 'Delegated task',
        }),
        expect.anything(),
      );
    });

    it('should return result from service', async () => {
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-1',
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: testTopicId,
      });

      expect(result).toEqual({
        assistantMessageId: 'assistant-msg-1',
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });
    });

    it('should pass timeout parameter when provided', async () => {
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-1',
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        timeout: 60000,
        topicId: testTopicId,
      });

      expect(mockExecGroupSubAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
        }),
        expect.anything(),
      );
    });
  });

  describe('input validation', () => {
    it('should reject when agentId is missing', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execSubAgentTask({
          agentId: undefined,
          groupId: testGroupId,
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: testTopicId,
        } as any),
      ).rejects.toThrow();
    });

    it('should reject when instruction is missing', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execSubAgentTask({
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: undefined,
          parentMessageId: 'parent-msg-1',
          topicId: testTopicId,
        } as any),
      ).rejects.toThrow();
    });

    it('should reject when topicId is missing', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execSubAgentTask({
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: undefined,
        } as any),
      ).rejects.toThrow();
    });

    it('should reject when parentMessageId is missing', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execSubAgentTask({
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: 'Test instruction',
          parentMessageId: undefined,
          topicId: testTopicId,
        } as any),
      ).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('should re-throw TRPCError from service', async () => {
      const trpcError = new TRPCError({
        code: 'NOT_FOUND',
        message: 'Agent not found',
      });
      mockExecGroupSubAgentTask.mockRejectedValue(trpcError);

      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execSubAgentTask({
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: testTopicId,
        }),
      ).rejects.toThrow('Agent not found');
    });

    it('should wrap non-TRPCError as INTERNAL_SERVER_ERROR', async () => {
      mockExecGroupSubAgentTask.mockRejectedValue(new Error('Database connection failed'));

      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.execSubAgentTask({
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: testTopicId,
        }),
      ).rejects.toThrow('Failed to execute sub-agent task: Database connection failed');
    });
  });
});
