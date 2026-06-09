// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, sessions, threads, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../../aiAgent';
import { cleanupTestUser, createTestUser } from './setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock AiAgentService - controls task execution behavior
const mockExecGroupSubAgentTask = vi.fn();
const mockInterruptTask = vi.fn();
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execSubAgentTask: mockExecGroupSubAgentTask,
    interruptTask: mockInterruptTask,
  })),
}));

// Mock AgentRuntimeService - controls operation status
const mockGetOperationStatus = vi.fn();
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    getOperationStatus: mockGetOperationStatus,
  })),
}));

// Mock AiChatService
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));

describe('Agent Task Integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let testAgentId: string;
  let testAgent2Id: string;
  let testGroupId: string;
  let testTopicId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);

    // Create test agents
    const [agent1] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Test SubAgent 1',
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
      })
      .returning();
    testAgentId = agent1.id;

    const [agent2] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Test SubAgent 2',
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemRole: 'You are another helpful assistant.',
      })
      .returning();
    testAgent2Id = agent2.id;

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

    // Reset mocks
    mockExecGroupSubAgentTask.mockReset();
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

  describe('complete task execution lifecycle', () => {
    it('should complete full task execution lifecycle', async () => {
      const threadId = 'thread-lifecycle-test';
      const operationId = 'op-lifecycle-test';

      // Setup: Create thread in DB to simulate service behavior
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-1',
        type: ThreadType.Isolation,
        status: ThreadStatus.Processing,
        metadata: { operationId },
      });

      // 1. Mock service to return success
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-1',
        operationId,
        success: true,
        threadId,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Create task
      const createResult = await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: testTopicId,
      });

      expect(createResult.success).toBe(true);
      expect(createResult.threadId).toBe(threadId);
      expect(createResult.operationId).toBe(operationId);

      // 2. Query status (processing)
      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'running',
          stepCount: 2,
        },
        isCompleted: false,
        hasError: false,
        metadata: {},
      });

      const processingStatus = await caller.getSubAgentTaskStatus({
        threadId,
      });

      expect(processingStatus.status).toBe('processing');
      expect(processingStatus.stepCount).toBe(2);

      // 3. Simulate task completion by updating Thread status
      // Note: Status now comes from Thread table, Redis only supplements real-time info
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Completed,
          metadata: {
            operationId,
            completedAt: '2024-01-01T12:00:00Z',
            totalCost: 0.05,
            totalTokens: 1500,
          },
        })
        .where(eq(threads.id, threadId));

      // Mock realtime status from Redis (optional, used for stepCount)
      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'done',
          stepCount: 5,
          cost: { total: 0.05 },
          usage: { total_tokens: 1500 },
        },
        isCompleted: true,
        hasError: false,
        metadata: { lastActiveAt: '2024-01-01T12:00:00Z' },
      });

      const completedStatus = await caller.getSubAgentTaskStatus({
        threadId,
      });

      expect(completedStatus.status).toBe('completed');
      expect(completedStatus.completedAt).toBe('2024-01-01T12:00:00Z');

      // Verify taskDetail contains thread info
      expect(completedStatus.taskDetail).toBeDefined();
      expect(completedStatus.taskDetail?.threadId).toBe(threadId);
      expect(completedStatus.taskDetail?.status).toBe(ThreadStatus.Completed);
      expect(completedStatus.taskDetail?.totalCost).toBe(0.05);
      expect(completedStatus.taskDetail?.totalTokens).toBe(1500);

      // 4. Verify Thread status in DB
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, threadId));

      expect(thread.status).toBe(ThreadStatus.Completed);
      expect(thread.metadata?.completedAt).toBeDefined();
    });
  });

  describe('task interrupt flow', () => {
    it('should interrupt running task', async () => {
      const threadId = 'thread-interrupt-test';
      const operationId = 'op-interrupt-test';

      // Setup: Create thread in DB
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-2',
        type: ThreadType.Isolation,
        status: ThreadStatus.Processing,
        metadata: { operationId },
      });

      // 1. Create task
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-2',
        operationId,
        success: true,
        threadId,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Long running task',
        parentMessageId: 'parent-msg-2',
        topicId: testTopicId,
      });

      expect(createResult.success).toBe(true);

      // 2. Mock interruptTask and call it
      mockInterruptTask.mockResolvedValue({
        success: true,
        threadId,
      });

      const interruptResult = await caller.interruptTask({
        threadId,
      });

      expect(interruptResult.success).toBe(true);
      expect(interruptResult.threadId).toBe(threadId);

      // 3. Update thread status to Cancel (since status comes from Thread table now)
      await serverDB
        .update(threads)
        .set({ status: ThreadStatus.Cancel })
        .where(eq(threads.id, threadId));

      const statusResult = await caller.getSubAgentTaskStatus({
        threadId,
      });

      expect(statusResult.status).toBe('cancel');

      // 4. Verify Thread status
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, threadId));

      expect(thread.status).toBe(ThreadStatus.Cancel);
    });
  });

  describe('task failure handling', () => {
    it('should handle task failure during creation', async () => {
      const threadId = 'thread-fail-test';
      const operationId = 'op-fail-test';

      // Setup: Create thread in DB with failed status
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-3',
        type: ThreadType.Isolation,
        status: ThreadStatus.Failed,
        metadata: { operationId, error: 'Agent execution failed' },
      });

      // Mock service to return failure
      mockExecGroupSubAgentTask.mockResolvedValue({
        assistantMessageId: 'assistant-msg-3',
        error: 'Agent execution failed',
        operationId,
        success: false,
        threadId,
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const createResult = await caller.execSubAgentTask({
        agentId: testAgentId,
        groupId: testGroupId,
        instruction: 'Failing task',
        parentMessageId: 'parent-msg-3',
        topicId: testTopicId,
      });

      expect(createResult.success).toBe(false);
      expect(createResult.error).toBe('Agent execution failed');
      expect(createResult.threadId).toBe(threadId);

      // Verify Thread status
      const [thread] = await serverDB.select().from(threads).where(eq(threads.id, threadId));

      expect(thread.status).toBe(ThreadStatus.Failed);
      expect(thread.metadata?.error).toBe('Agent execution failed');
    });

    it('should handle task failure during execution', async () => {
      const threadId = 'thread-exec-fail-test';
      const operationId = 'op-exec-fail-test';

      // Setup: Create thread in DB with Failed status and error in metadata
      // Note: Status now comes from Thread table, Redis only supplements real-time info
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-4',
        type: ThreadType.Isolation,
        status: ThreadStatus.Failed,
        metadata: { operationId, error: 'Tool execution timeout' },
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const statusResult = await caller.getSubAgentTaskStatus({
        threadId,
      });

      expect(statusResult.status).toBe('failed');
      expect(statusResult.error).toBe('Tool execution timeout');

      // Verify taskDetail contains thread info
      expect(statusResult.taskDetail).toBeDefined();
      expect(statusResult.taskDetail?.threadId).toBe(threadId);
      expect(statusResult.taskDetail?.status).toBe(ThreadStatus.Failed);
    });
  });

  describe('concurrent task execution', () => {
    it('should handle concurrent task execution', async () => {
      const threadId1 = 'thread-concurrent-1';
      const threadId2 = 'thread-concurrent-2';
      const operationId1 = 'op-concurrent-1';
      const operationId2 = 'op-concurrent-2';

      // Setup: Create threads in DB
      await serverDB.insert(threads).values([
        {
          id: threadId1,
          userId,
          agentId: testAgentId,
          topicId: testTopicId,
          groupId: testGroupId,
          sourceMessageId: 'parent-msg-5',
          type: ThreadType.Isolation,
          status: ThreadStatus.Processing,
          metadata: { operationId: operationId1 },
        },
        {
          id: threadId2,
          userId,
          agentId: testAgent2Id,
          topicId: testTopicId,
          groupId: testGroupId,
          sourceMessageId: 'parent-msg-5',
          type: ThreadType.Isolation,
          status: ThreadStatus.Processing,
          metadata: { operationId: operationId2 },
        },
      ]);

      // Mock service to return different results for each call
      let callCount = 0;
      mockExecGroupSubAgentTask.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            assistantMessageId: 'assistant-msg-5',
            operationId: operationId1,
            success: true,
            threadId: threadId1,
          });
        }
        return Promise.resolve({
          assistantMessageId: 'assistant-msg-6',
          operationId: operationId2,
          success: true,
          threadId: threadId2,
        });
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Execute tasks concurrently
      const [task1, task2] = await Promise.all([
        caller.execSubAgentTask({
          agentId: testAgentId,
          groupId: testGroupId,
          instruction: 'Task 1',
          parentMessageId: 'parent-msg-5',
          topicId: testTopicId,
        }),
        caller.execSubAgentTask({
          agentId: testAgent2Id,
          groupId: testGroupId,
          instruction: 'Task 2',
          parentMessageId: 'parent-msg-5',
          topicId: testTopicId,
        }),
      ]);

      // Verify both tasks created successfully
      expect(task1.success).toBe(true);
      expect(task2.success).toBe(true);
      expect(task1.threadId).not.toBe(task2.threadId);
      expect(task1.operationId).not.toBe(task2.operationId);

      // Verify threads exist in DB
      const threadsInDB = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.topicId, testTopicId));

      expect(threadsInDB.length).toBe(2);
    });
  });

  describe('query task by threadId', () => {
    it('should query task status by threadId', async () => {
      const threadId = 'thread-query-test';
      const operationId = 'op-query-test';

      // Setup: Create thread in DB
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-6',
        type: ThreadType.Isolation,
        status: ThreadStatus.Processing,
        metadata: { operationId },
      });

      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'running',
          stepCount: 2,
        },
        isCompleted: false,
        hasError: false,
        metadata: {},
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Query by threadId
      const status = await caller.getSubAgentTaskStatus({
        threadId,
      });

      expect(status.status).toBe('processing');
      expect(status.stepCount).toBe(2);
    });
  });

  describe('step lifecycle callbacks - thread metadata updates', () => {
    it('should have complete metadata after task completion', async () => {
      const threadId = 'thread-metadata-test';
      const operationId = 'op-metadata-test';
      const startedAt = '2024-01-01T10:00:00.000Z';
      const completedAt = '2024-01-01T10:05:00.000Z';

      // Setup: Create thread with complete metadata (simulating what callbacks would set)
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-metadata',
        type: ThreadType.Isolation,
        status: ThreadStatus.Completed,
        metadata: {
          completedAt,
          duration: 300000, // 5 minutes
          operationId,
          startedAt,
          totalCost: 0.0123,
          totalMessages: 5,
          totalTokens: 2500,
          totalToolCalls: 3,
        },
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Query task status
      const status = await caller.getSubAgentTaskStatus({ threadId });

      // Verify all metadata fields are accessible
      expect(status.status).toBe('completed');
      expect(status.completedAt).toBe(completedAt);

      // Verify taskDetail contains all callback-populated metadata
      expect(status.taskDetail).toBeDefined();
      expect(status.taskDetail?.threadId).toBe(threadId);
      expect(status.taskDetail?.status).toBe(ThreadStatus.Completed);
      expect(status.taskDetail?.startedAt).toBe(startedAt);
      expect(status.taskDetail?.completedAt).toBe(completedAt);
      expect(status.taskDetail?.duration).toBe(300000);
      expect(status.taskDetail?.totalCost).toBe(0.0123);
      expect(status.taskDetail?.totalMessages).toBe(5);
      expect(status.taskDetail?.totalTokens).toBe(2500);
      expect(status.taskDetail?.totalToolCalls).toBe(3);
    });

    it('should have partial metadata during task processing', async () => {
      const threadId = 'thread-processing-metadata';
      const operationId = 'op-processing-metadata';
      const startedAt = new Date().toISOString();

      // Setup: Create thread with partial metadata (during processing, onAfterStep updates)
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-processing',
        type: ThreadType.Isolation,
        status: ThreadStatus.Processing,
        metadata: {
          operationId,
          startedAt,
          totalMessages: 3,
          totalTokens: 1200,
          totalToolCalls: 1,
        },
      });

      // Mock realtime status from operation
      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'running',
          stepCount: 3,
        },
        isCompleted: false,
        hasError: false,
        metadata: {},
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const status = await caller.getSubAgentTaskStatus({ threadId });

      // Should be processing with partial metadata
      expect(status.status).toBe('processing');
      expect(status.taskDetail?.startedAt).toBe(startedAt);
      expect(status.taskDetail?.totalMessages).toBe(3);
      expect(status.taskDetail?.totalTokens).toBe(1200);
      expect(status.taskDetail?.totalToolCalls).toBe(1);
      // completedAt and duration should not be set yet
      expect(status.taskDetail?.completedAt).toBeUndefined();
      expect(status.taskDetail?.duration).toBeUndefined();
    });

    it('should have error info in metadata when task fails', async () => {
      const threadId = 'thread-error-metadata';
      const operationId = 'op-error-metadata';
      const startedAt = '2024-01-01T10:00:00.000Z';
      const completedAt = '2024-01-01T10:01:30.000Z';
      const errorMessage = 'Tool execution failed: API rate limit exceeded';

      // Setup: Create thread with error metadata (simulating onComplete with error)
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-error',
        type: ThreadType.Isolation,
        status: ThreadStatus.Failed,
        metadata: {
          completedAt,
          duration: 90000, // 1.5 minutes
          error: errorMessage,
          operationId,
          startedAt,
          totalCost: 0.005,
          totalMessages: 2,
          totalTokens: 800,
          totalToolCalls: 1,
        },
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const status = await caller.getSubAgentTaskStatus({ threadId });

      // Should be failed with error in metadata
      expect(status.status).toBe('failed');
      expect(status.error).toBe(errorMessage);
      expect(status.taskDetail?.error).toBe(errorMessage);
      expect(status.taskDetail?.duration).toBe(90000);
      expect(status.taskDetail?.totalToolCalls).toBe(1);
    });

    it('should have correct status when task is interrupted', async () => {
      const threadId = 'thread-interrupted-metadata';
      const operationId = 'op-interrupted-metadata';
      const startedAt = '2024-01-01T10:00:00.000Z';
      const completedAt = '2024-01-01T10:02:00.000Z';

      // Setup: Create thread with interrupted status (simulating onComplete with 'interrupted' reason)
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-interrupted',
        type: ThreadType.Isolation,
        status: ThreadStatus.Cancel,
        metadata: {
          completedAt,
          duration: 120000, // 2 minutes
          operationId,
          startedAt,
          totalCost: 0.008,
          totalMessages: 3,
          totalTokens: 1000,
          totalToolCalls: 2,
        },
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const status = await caller.getSubAgentTaskStatus({ threadId });

      expect(status.status).toBe('cancel');
      expect(status.taskDetail?.status).toBe(ThreadStatus.Cancel);
      expect(status.taskDetail?.completedAt).toBe(completedAt);
      expect(status.taskDetail?.duration).toBe(120000);
    });

    it('should have correct status when waiting for human intervention', async () => {
      const threadId = 'thread-inreview-metadata';
      const operationId = 'op-inreview-metadata';
      const startedAt = '2024-01-01T10:00:00.000Z';

      // Setup: Create thread with InReview status (simulating onComplete with 'waiting_for_human' reason)
      await serverDB.insert(threads).values({
        id: threadId,
        userId,
        agentId: testAgentId,
        topicId: testTopicId,
        groupId: testGroupId,
        sourceMessageId: 'parent-msg-inreview',
        type: ThreadType.Isolation,
        status: ThreadStatus.InReview,
        metadata: {
          operationId,
          startedAt,
          totalMessages: 4,
          totalTokens: 1500,
          totalToolCalls: 2,
        },
      });

      // Mock realtime status showing waiting for human
      mockGetOperationStatus.mockResolvedValue({
        currentState: {
          status: 'waiting_for_human',
          stepCount: 4,
          pendingToolsCalling: [{ name: 'dangerous_tool' }],
        },
        isCompleted: false,
        hasError: false,
        needsHumanInput: true,
        metadata: {},
      });

      const caller = aiAgentRouter.createCaller(createTestContext());

      const status = await caller.getSubAgentTaskStatus({ threadId });

      // Status should reflect InReview from Thread table
      expect(status.taskDetail?.status).toBe(ThreadStatus.InReview);
      expect(status.taskDetail?.totalToolCalls).toBe(2);
    });
  });
});
