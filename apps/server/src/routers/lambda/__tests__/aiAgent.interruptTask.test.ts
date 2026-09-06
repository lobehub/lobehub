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

// Mock deviceGateway so we can assert cancelHeteroTask dispatches without a
// live device connection. Use vi.hoisted so the mock fn is available to the
// hoisted vi.mock factory.
const { mockExecuteToolCall } = vi.hoisted(() => ({
  mockExecuteToolCall: vi.fn(),
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeToolCall: mockExecuteToolCall,
  },
  getScopedOnlineDevices: vi.fn(() => []),
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
    mockExecuteToolCall.mockReset();
    mockExecuteToolCall.mockResolvedValue({ content: '{}', success: true });

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

  // Regression: previously only remote-task hetero types (openclaw / hermes)
  // triggered a `cancelHeteroTask` dispatch to the device. Local-cli types
  // (claude-code / codex / devin / trae / qoder) that also run on a remote
  // device via `dispatchAgentRun` were silently skipped — the UI showed
  // cancelled but the CLI process kept running. Now any hetero type with a
  // deviceId in the topic's runningOperation triggers the cancel dispatch.
  describe('device hetero cancel dispatch', () => {
    it.each(['devin', 'claude-code', 'codex', 'trae', 'qoder', 'openclaw', 'hermes'] as const)(
      'dispatches cancelHeteroTask for %s running on a device',
      async (heteroType) => {
        // Seed topic.metadata.runningOperation with a device + heteroType so
        // interruptTask can resolve the target without a separate device lookup.
        await serverDB
          .update(topics)
          .set({
            metadata: {
              runningOperation: {
                assistantMessageId: 'asst-cancel-test',
                deviceId: 'device-1',
                deviceWorkspaceId: 'ws-device',
                heteroType,
                operationId: 'op-device-cancel',
              },
            },
          })
          .where(eq(topics.id, testTopicId));

        // Also point the thread's operationId at the same op so the router
        // resolves it without needing a separate operation row.
        await serverDB
          .update(threads)
          .set({ metadata: { operationId: 'op-device-cancel' } })
          .where(eq(threads.id, testThreadId));

        const caller = aiAgentRouter.createCaller(createTestContext());

        await caller.interruptTask({
          operationId: 'op-device-cancel',
          topicId: testTopicId,
        });

        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ deviceId: 'device-1' }),
          expect.objectContaining({
            apiName: 'cancelHeteroTask',
            identifier: 'cancelHeteroTask',
          }),
          10_000,
        );

        // The signal should be SIGINT (graceful) and taskId should match the
        // operationId so the device can look up the process.
        const [, toolCall] = mockExecuteToolCall.mock.calls[0];
        const args = JSON.parse(toolCall.arguments);
        expect(args.signal).toBe('SIGINT');
        expect(args.taskId).toBe('op-device-cancel');
      },
    );

    it('does not dispatch cancelHeteroTask when the operation has no deviceId', async () => {
      // runningOperation with heteroType but no deviceId — e.g. a cloud-sandbox
      // run that has no remote process to kill.
      await serverDB
        .update(topics)
        .set({
          metadata: {
            runningOperation: {
              assistantMessageId: 'asst-no-device',
              heteroType: 'devin',
              operationId: 'op-no-device',
            },
          },
        })
        .where(eq(topics.id, testTopicId));

      await serverDB
        .update(threads)
        .set({ metadata: { operationId: 'op-no-device' } })
        .where(eq(threads.id, testThreadId));

      const caller = aiAgentRouter.createCaller(createTestContext());

      await caller.interruptTask({
        operationId: 'op-no-device',
        topicId: testTopicId,
      });

      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });
  });
});
