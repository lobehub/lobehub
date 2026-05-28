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
  getServerDB: vi.fn(() => testDB),
}));

// Mock AiAgentService
const mockExecGroupSubAgentTask = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execSubAgentTask: mockExecGroupSubAgentTask,
  })),
}));

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));

// Mock AiChatService
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
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

      expect(mockExecGroupSubAgentTask).toHaveBeenCalledWith({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        timeout: undefined,
        topicId: testTopicId,
      });
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
