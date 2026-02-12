// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroups,
  messages,
  sessions,
  threads,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock AgentRuntimeService
const mockGetOperationStatus = vi.fn();
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    getOperationStatus: mockGetOperationStatus,
  })),
}));

// Mock AiAgentService
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({})),
}));

// Mock AiChatService
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));

describe('aiAgentRouter.getSubAgentTaskStatus', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;
  let testGroupId: string;
  let testTopicId: string;
  let testThreadId: string;

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

    // Create test thread
    const [thread] = (await serverDB
      .insert(threads)
      .values({
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'source-msg-1',
        type: ThreadType.Isolation,
        status: ThreadStatus.Processing,
        metadata: { operationId: 'op-test-123' },
      })
      .returning()) as any[];
    testThreadId = thread.id;

    // Reset mock
    mockGetOperationStatus.mockReset();
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createTestContext = () => ({
    userId,
    jwtPayload: { userId },
  });

  describe('query by threadId', () => {
    it('should return task status from Thread table', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.taskDetail).toBeDefined();
      expect(result.taskDetail?.threadId).toBe(testThreadId);
      expect(result.taskDetail?.status).toBe(ThreadStatus.Processing);
    });

    it('should throw NOT_FOUND when thread does not exist', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.getSubAgentTaskStatus({
          threadId: 'non-existent-thread-id',
        }),
      ).rejects.toThrow('Thread not found');
    });

    it('should return completed status from Thread', async () => {
      // Update thread to completed status
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Completed,
          metadata: {
            operationId: 'op-test-123',
            completedAt: '2024-01-01T00:00:00Z',
            duration: 5000,
            totalTokens: 1000,
            totalToolCalls: 3,
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('completed');
      expect(result.completedAt).toBe('2024-01-01T00:00:00Z');
      expect(result.taskDetail?.duration).toBe(5000);
      expect(result.taskDetail?.totalTokens).toBe(1000);
      expect(result.taskDetail?.totalToolCalls).toBe(3);
    });
  });

  describe('status mapping from ThreadStatus', () => {
    it.each([
      [ThreadStatus.Active, 'processing'],
      [ThreadStatus.Processing, 'processing'],
      [ThreadStatus.Pending, 'processing'],
      [ThreadStatus.InReview, 'processing'],
      [ThreadStatus.Todo, 'processing'],
      [ThreadStatus.Completed, 'completed'],
      [ThreadStatus.Failed, 'failed'],
      [ThreadStatus.Cancel, 'cancel'],
    ])(
      'should map ThreadStatus.%s to task status "%s"',
      async (threadStatus, expectedTaskStatus) => {
        // Update thread status
        await serverDB
          .update(threads)
          .set({ status: threadStatus })
          .where(eq(threads.id, testThreadId));

        const caller = aiAgentRouter.createCaller(createTestContext());

        const result = await caller.getSubAgentTaskStatus({
          threadId: testThreadId,
        });

        expect(result.status).toBe(expectedTaskStatus);
      },
    );
  });

  describe('real-time status from Redis', () => {
    it('should supplement with Redis status when available for processing tasks', async () => {
      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'running',
          stepCount: 3,
          cost: { total: 0.05 },
          usage: { total_tokens: 1000 },
        },
        isCompleted: false,
        hasError: false,
        metadata: {},
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.stepCount).toBe(3);
      expect(result.cost).toEqual({ total: 0.05 });
      expect(mockGetOperationStatus).toHaveBeenCalledWith({
        operationId: 'op-test-123',
      });
    });

    it('should extract totalToolCalls from usage.tools.totalCalls', async () => {
      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'running',
          stepCount: 2,
          cost: { total: 0.006678 },
          usage: {
            llm: {
              tokens: { total: 8358 },
            },
            tools: {
              totalCalls: 5,
              byTool: [
                { name: 'lobe-web-browsing/search', calls: 3 },
                { name: 'lobe-web-browsing/fetch', calls: 2 },
              ],
            },
          },
        },
        stats: { totalMessages: 4 },
        isCompleted: false,
        hasError: false,
        metadata: {},
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.taskDetail?.totalToolCalls).toBe(5);
      expect(result.taskDetail?.totalTokens).toBe(8358);
    });

    it('should fallback to Thread data when Redis returns null (operation expired)', async () => {
      // getOperationStatus now returns null when operation not found (instead of throwing)
      mockGetOperationStatus.mockResolvedValue(null);

      // Update thread with metadata
      await serverDB
        .update(threads)
        .set({
          metadata: {
            operationId: 'op-test-123',
            totalTokens: 500,
            totalCost: 0.02,
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.usage).toEqual({ total_tokens: 500 });
      expect(result.cost).toEqual({ total: 0.02 });
    });

    it('should not query Redis for completed tasks', async () => {
      // Update thread to completed status
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Completed,
          metadata: { operationId: 'op-test-123' },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      // Should not call Redis for completed tasks
      expect(mockGetOperationStatus).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should include error message from Thread metadata', async () => {
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Failed,
          metadata: {
            operationId: 'op-test-123',
            error: 'Tool execution failed',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Tool execution failed');
      expect(result.taskDetail?.error).toBe('Tool execution failed');
    });
  });

  describe('taskDetail', () => {
    it('should include complete taskDetail in response', async () => {
      const startedAt = '2024-01-01T10:00:00.000Z';
      const completedAt = '2024-01-01T10:05:00.000Z';

      await serverDB
        .update(threads)
        .set({
          title: 'Research Task',
          status: ThreadStatus.Completed,
          metadata: {
            operationId: 'op-test-123',
            startedAt,
            completedAt,
            duration: 300000,
            totalTokens: 5000,
            totalToolCalls: 10,
            totalMessages: 20,
            totalCost: 0.15,
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.taskDetail).toEqual({
        threadId: testThreadId,
        title: 'Research Task',
        status: ThreadStatus.Completed,
        startedAt,
        completedAt,
        duration: 300000,
        totalTokens: 5000,
        totalToolCalls: 10,
        totalMessages: 20,
        totalCost: 0.15,
        error: undefined,
      });
    });
  });

  describe('input validation', () => {
    it('should require threadId', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(caller.getSubAgentTaskStatus({} as any)).rejects.toThrow();
    });
  });

  describe('result content', () => {
    it('should return result content from last assistant message when task is completed', async () => {
      // Create assistant messages in the thread with different timestamps
      const now = new Date();
      await serverDB.insert(messages).values([
        {
          userId,
          role: 'user',
          content: 'User question',
          agentId: testAgentId,
          topicId: testTopicId,
          threadId: testThreadId,
          createdAt: new Date(now.getTime() - 2000),
        },
        {
          userId,
          role: 'assistant',
          content: 'First assistant response',
          agentId: testAgentId,
          topicId: testTopicId,
          threadId: testThreadId,
          createdAt: new Date(now.getTime() - 1000),
        },
        {
          userId,
          role: 'assistant',
          content: 'This is the final result of the task execution.',
          agentId: testAgentId,
          topicId: testTopicId,
          threadId: testThreadId,
          createdAt: now,
        },
      ]);

      // Update thread to completed status
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Completed,
          metadata: {
            operationId: 'op-test-123',
            completedAt: '2024-01-01T00:00:00Z',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('completed');
      expect(result.result).toBe('This is the final result of the task execution.');
    });

    it('should return result content from last assistant message when task is failed', async () => {
      // Create assistant message in the thread
      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: 'Partial result before failure.',
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: testThreadId,
      });

      // Update thread to failed status
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Failed,
          metadata: {
            operationId: 'op-test-123',
            error: 'Task failed due to timeout',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('failed');
      expect(result.result).toBe('Partial result before failure.');
      expect(result.error).toBe('Task failed due to timeout');
    });

    it('should not return result content when task is still processing', async () => {
      // Create assistant message in the thread
      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: 'Some content',
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: testThreadId,
      });

      // Thread is in processing status (default from beforeEach)
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.result).toBeUndefined();
    });

    it('should return undefined result when no assistant messages in thread', async () => {
      // Update thread to completed status without any messages
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Completed,
          metadata: {
            operationId: 'op-test-123',
            completedAt: '2024-01-01T00:00:00Z',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('completed');
      expect(result.result).toBeUndefined();
    });
  });

  describe('currentActivity', () => {
    it('should return tool_calling activity when last assistant message has tools', async () => {
      // Create assistant message with tools
      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: '',
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: testThreadId,
        tools: [
          { identifier: 'lobe-web-browsing', apiName: 'search', arguments: '{"query":"test"}' },
        ],
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.currentActivity).toEqual({
        type: 'tool_calling',
        identifier: 'lobe-web-browsing',
        apiName: 'search',
      });
    });

    it('should return tool_result activity when last message is tool role', async () => {
      // First create the assistant message, then create tool message
      const now = new Date();
      await serverDB.insert(messages).values([
        {
          userId,
          role: 'assistant',
          content: '',
          agentId: testAgentId,
          topicId: testTopicId,
          threadId: testThreadId,
          tools: [{ identifier: 'lobe-web-browsing', apiName: 'search' }],
          createdAt: new Date(now.getTime() - 1000),
        },
        {
          userId,
          role: 'tool',
          content: 'Search results: found 10 items matching your query...',
          agentId: testAgentId,
          topicId: testTopicId,
          threadId: testThreadId,
          createdAt: now,
        },
      ]);

      // Update the tool message with plugin info
      const toolMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.threadId, testThreadId));
      const toolMsg = toolMessages.find((m) => m.role === 'tool');

      if (toolMsg) {
        const { messagePlugins } = await import('@lobechat/database/schemas');
        await serverDB.insert(messagePlugins).values({
          id: toolMsg.id,
          userId,
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          type: 'default',
        });
      }

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.currentActivity?.type).toBe('tool_result');
      expect(result.currentActivity?.identifier).toBe('lobe-web-browsing');
      expect(result.currentActivity?.apiName).toBe('search');
      expect(result.currentActivity?.contentPreview).toBe(
        'Search results: found 10 items matching your query...',
      );
    });

    it('should return generating activity when last assistant message has no tools', async () => {
      // Create assistant message without tools
      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: 'I am generating a response based on the information...',
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: testThreadId,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.currentActivity).toEqual({
        type: 'generating',
        contentPreview: 'I am generating a response based on the information...',
      });
    });

    it('should truncate contentPreview to 100 characters', async () => {
      const longContent = 'A'.repeat(200);

      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: longContent,
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: testThreadId,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.currentActivity?.contentPreview).toBe('A'.repeat(100));
    });

    it('should not return currentActivity when task is completed', async () => {
      // Create messages in thread
      await serverDB.insert(messages).values({
        userId,
        role: 'assistant',
        content: 'Final result',
        agentId: testAgentId,
        topicId: testTopicId,
        threadId: testThreadId,
      });

      // Update thread to completed status
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Completed,
          metadata: {
            operationId: 'op-test-123',
            completedAt: '2024-01-01T00:00:00Z',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('completed');
      expect(result.currentActivity).toBeUndefined();
    });

    it('should not return currentActivity when no messages in thread', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.getSubAgentTaskStatus({
        threadId: testThreadId,
      });

      expect(result.status).toBe('processing');
      expect(result.currentActivity).toBeUndefined();
    });
  });
});
