// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, sessions, threads, topics } from '@lobechat/database/schemas';
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

const mockInterruptOperation = vi.fn();

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    interruptOperation: mockInterruptOperation,
  })),
}));

// Mock AiChatService
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));

describe('aiAgentRouter.interruptTask', () => {
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
    mockInterruptOperation.mockReset();
    mockInterruptOperation.mockResolvedValue(true);

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

    // Create test thread with operationId in metadata
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
        metadata: { operationId: 'op-interrupt-test' },
      })
      .returning()) as any[];
    testThreadId = thread.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  const createTestContext = () => ({
    userId,
    jwtPayload: { userId },
  });

  describe('interrupt by threadId', () => {
    it('should interrupt task and update thread status to cancel', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.interruptTask({
        threadId: testThreadId,
      });

      expect(result.success).toBe(true);
      expect(result.threadId).toBe(testThreadId);
      expect(result.operationId).toBe('op-interrupt-test');

      // Verify thread status was updated
      const [updatedThread] = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.id, testThreadId));

      expect(updatedThread.status).toBe(ThreadStatus.Cancel);
      expect(updatedThread.metadata?.completedAt).toBeDefined();
    });

    it('should throw NOT_FOUND when thread does not exist', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(
        caller.interruptTask({
          threadId: 'non-existent-thread-id',
        }),
      ).rejects.toThrow('Thread not found');
    });

    it('should work even when thread has no operationId (only updates thread status)', async () => {
      // Create a thread without operationId
      const [threadWithoutOp] = (await serverDB
        .insert(threads)
        .values({
          userId,
          agentId: testAgentId,
          topicId: testTopicId,
          groupId: testGroupId,
          sourceMessageId: 'source-msg-2',
          type: ThreadType.Isolation,
          status: ThreadStatus.Processing,
          metadata: {},
        })
        .returning()) as any[];

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Should throw BAD_REQUEST because no operationId found
      await expect(
        caller.interruptTask({
          threadId: threadWithoutOp.id,
        }),
      ).rejects.toThrow('Operation ID not found');
    });
  });

  describe('interrupt by operationId', () => {
    it('should interrupt task by operationId directly', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.interruptTask({
        operationId: 'op-direct-interrupt',
      });

      expect(result.success).toBe(true);
      expect(result.operationId).toBe('op-direct-interrupt');
      // threadId should be undefined when only operationId is provided
      expect(result.threadId).toBeUndefined();
    });

    it('should use both threadId and operationId when both provided', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.interruptTask({
        threadId: testThreadId,
        operationId: 'op-override',
      });

      // operationId should take precedence
      expect(result.operationId).toBe('op-override');
      expect(result.threadId).toBe(testThreadId);

      // Thread should still be updated
      const [updatedThread] = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.id, testThreadId));

      expect(updatedThread.status).toBe(ThreadStatus.Cancel);
    });
  });

  describe('interrupt failure handling', () => {
    it('should return success=false and keep thread processing when runtime interrupt fails', async () => {
      mockInterruptOperation.mockResolvedValue(false);

      const caller = aiAgentRouter.createCaller(createTestContext());

      const result = await caller.interruptTask({
        threadId: testThreadId,
      });

      expect(result.success).toBe(false);
      expect(result.threadId).toBe(testThreadId);
      expect(result.operationId).toBe('op-interrupt-test');

      const [updatedThread] = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.id, testThreadId));

      expect(updatedThread.status).toBe(ThreadStatus.Processing);
      expect(updatedThread.metadata?.completedAt).toBeUndefined();
    });
  });

  describe('thread status preservation', () => {
    it('should preserve existing thread metadata when updating status', async () => {
      // Update thread to have some existing metadata
      await serverDB
        .update(threads)
        .set({
          metadata: {
            operationId: 'op-interrupt-test',
            startedAt: '2024-01-01T00:00:00Z',
            customField: 'preserved',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.interruptTask({
        threadId: testThreadId,
      });

      const [updatedThread] = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.id, testThreadId));

      // Existing metadata should be preserved
      expect(updatedThread.metadata?.operationId).toBe('op-interrupt-test');
      expect(updatedThread.metadata?.startedAt).toBe('2024-01-01T00:00:00Z');
      expect(updatedThread.metadata?.customField).toBe('preserved');
      // New metadata should be added
      expect(updatedThread.metadata?.completedAt).toBeDefined();
    });
  });

  describe('input validation', () => {
    it('should require at least one of threadId or operationId', async () => {
      const caller = aiAgentRouter.createCaller(createTestContext());

      await expect(caller.interruptTask({} as any)).rejects.toThrow();
    });
  });

  describe('already cancelled thread', () => {
    it('should handle re-interrupting an already cancelled thread', async () => {
      // Update thread to cancelled status
      await serverDB
        .update(threads)
        .set({
          status: ThreadStatus.Cancel,
          metadata: {
            operationId: 'op-interrupt-test',
            completedAt: '2024-01-01T00:00:00Z',
          },
        })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      // Should still succeed (idempotent operation)
      const result = await caller.interruptTask({
        threadId: testThreadId,
      });

      expect(result.success).toBe(true);
    });
  });
});
