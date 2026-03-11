import { type AgentState } from '@lobechat/agent-runtime';
import { ThreadStatus } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { type ChatStore } from '@/store/chat/store';

import { createGroupOrchestrationExecutors } from '../createGroupOrchestrationExecutors';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execSubAgentTask: vi.fn(),
    getSubAgentTaskStatus: vi.fn(),
  },
}));

/**
 * Helper to create a mock ExecSubAgentTaskResult
 */
const createMockExecResult = (overrides: Record<string, any> = {}) => ({
  assistantMessageId: `assistant_${nanoid()}`,
  operationId: `op_${nanoid()}`,
  success: true,
  threadId: `thread_${nanoid()}`,
  ...overrides,
});

const TEST_IDS = {
  AGENT_1_ID: 'test-agent-1-id',
  AGENT_2_ID: 'test-agent-2-id',
  GROUP_ID: 'test-group-id',
  OPERATION_ID: 'test-operation-id',
  ORCHESTRATION_OPERATION_ID: 'test-orchestration-operation-id',
  SUPERVISOR_AGENT_ID: 'test-supervisor-agent-id',
  TOOL_MESSAGE_ID: 'test-tool-message-id',
  TOPIC_ID: 'test-topic-id',
};

/**
 * Create a minimal mock store for group orchestration executor tests
 */
const createMockStore = (overrides: Partial<ChatStore> = {}): ChatStore => {
  const operations: Record<string, any> = {
    [TEST_IDS.OPERATION_ID]: {
      abortController: new AbortController(),
      context: {},
      id: TEST_IDS.OPERATION_ID,
      status: 'running',
      type: 'agent',
    },
  };

  return {
    dbMessagesMap: {},
    internal_dispatchMessage: vi.fn(),
    internal_execAgentRuntime: vi.fn().mockResolvedValue(undefined),
    messagesMap: {},
    operations,
    optimisticCreateMessage: vi.fn().mockImplementation(async () => ({
      id: `msg_${nanoid()}`,
      messages: [],
    })),
    optimisticUpdateMessageContent: vi.fn().mockResolvedValue(undefined),
    startOperation: vi.fn().mockImplementation((config) => {
      const operationId = `op_${nanoid()}`;
      const abortController = new AbortController();
      operations[operationId] = {
        abortController,
        context: config.context || {},
        id: operationId,
        status: 'running',
        type: config.type,
      };
      return { abortController, operationId };
    }),
    ...overrides,
  } as unknown as ChatStore;
};

/**
 * Create initial agent state for testing
 */
const createInitialState = (overrides: Partial<AgentState> = {}): AgentState => {
  return {
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    maxSteps: 10,
    messages: [],
    operationId: TEST_IDS.OPERATION_ID,
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    userInterventionConfig: { allowList: [], approvalMode: 'auto' },
    ...overrides,
  } as AgentState;
};

describe('createGroupOrchestrationExecutors', () => {
  describe('batch_exec_async_tasks executor', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return error result when no valid context (missing groupId or topicId)', async () => {
      const mockStore = createMockStore();

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          scope: 'group',
          // Missing topicId
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      const result = await batchExecTasksExecutor(
        {
          payload: {
            tasks: [
              { agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' },
              { agentId: TEST_IDS.AGENT_2_ID, instruction: 'Task 2', title: 'Task 2 Title' },
            ],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      expect(result.result?.type).toBe('tasks_completed');
      expect((result.result?.payload as any).results).toHaveLength(2);
      expect((result.result?.payload as any).results[0].success).toBe(false);
      expect((result.result?.payload as any).results[0].error).toBe('No valid context available');
    });

    it('should create task messages for all tasks in parallel', async () => {
      const mockStore = createMockStore();

      // Mock execSubAgentTask to return success
      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-1' }),
      );

      // Mock getSubAgentTaskStatus to return completed immediately
      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        result: 'Task completed',
        status: 'completed',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      await batchExecTasksExecutor(
        {
          payload: {
            tasks: [
              { agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' },
              { agentId: TEST_IDS.AGENT_2_ID, instruction: 'Task 2', title: 'Task 2 Title' },
            ],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      // Should create 2 task messages
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledTimes(2);

      // Verify first task message creation
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: TEST_IDS.AGENT_1_ID,
          groupId: TEST_IDS.GROUP_ID,
          metadata: { instruction: 'Task 1', taskTitle: 'Task 1 Title' },
          parentId: TEST_IDS.TOOL_MESSAGE_ID,
          role: 'task',
          topicId: TEST_IDS.TOPIC_ID,
        }),
        expect.objectContaining({ operationId: TEST_IDS.OPERATION_ID }),
      );

      // Verify second task message creation
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: TEST_IDS.AGENT_2_ID,
          groupId: TEST_IDS.GROUP_ID,
          metadata: { instruction: 'Task 2', taskTitle: 'Task 2 Title' },
          parentId: TEST_IDS.TOOL_MESSAGE_ID,
          role: 'task',
          topicId: TEST_IDS.TOPIC_ID,
        }),
        expect.objectContaining({ operationId: TEST_IDS.OPERATION_ID }),
      );
    });

    it('should call execSubAgentTask for each task', async () => {
      const mockStore = createMockStore();
      let messageIdCounter = 0;

      vi.mocked(mockStore.optimisticCreateMessage).mockImplementation(async () => ({
        id: `msg_${++messageIdCounter}`,
        messages: [],
      }));

      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-1' }),
      );

      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        result: 'Task completed',
        status: 'completed',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      await batchExecTasksExecutor(
        {
          payload: {
            tasks: [
              { agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' },
              { agentId: TEST_IDS.AGENT_2_ID, instruction: 'Task 2', title: 'Task 2 Title' },
            ],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      // Should call execSubAgentTask for both tasks
      expect(aiAgentService.execSubAgentTask).toHaveBeenCalledTimes(2);

      expect(aiAgentService.execSubAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: TEST_IDS.AGENT_1_ID,
          groupId: TEST_IDS.GROUP_ID,
          instruction: 'Task 1',
          title: 'Task 1 Title',
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      expect(aiAgentService.execSubAgentTask).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: TEST_IDS.AGENT_2_ID,
          groupId: TEST_IDS.GROUP_ID,
          instruction: 'Task 2',
          title: 'Task 2 Title',
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );
    });

    it('should return tasks_completed result with all task results', async () => {
      const mockStore = createMockStore();

      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-1' }),
      );

      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        result: 'Task completed successfully',
        status: 'completed',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      const result = await batchExecTasksExecutor(
        {
          payload: {
            tasks: [
              { agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' },
              { agentId: TEST_IDS.AGENT_2_ID, instruction: 'Task 2', title: 'Task 2 Title' },
            ],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      expect(result.result?.type).toBe('tasks_completed');
      expect((result.result?.payload as any).results).toHaveLength(2);
      expect((result.result?.payload as any).results[0]).toMatchObject({
        agentId: TEST_IDS.AGENT_1_ID,
        result: 'Task completed successfully',
        success: true,
      });
      expect((result.result?.payload as any).results[1]).toMatchObject({
        agentId: TEST_IDS.AGENT_2_ID,
        result: 'Task completed successfully',
        success: true,
      });
    });

    it('should handle task creation failure', async () => {
      const mockStore = createMockStore();

      // First task message creation fails
      vi.mocked(mockStore.optimisticCreateMessage)
        .mockResolvedValueOnce(undefined) // First task fails
        .mockResolvedValueOnce({ id: 'msg_2', messages: [] }); // Second task succeeds

      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-2' }),
      );

      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        result: 'Task completed',
        status: 'completed',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      const result = await batchExecTasksExecutor(
        {
          payload: {
            tasks: [
              { agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' },
              { agentId: TEST_IDS.AGENT_2_ID, instruction: 'Task 2', title: 'Task 2 Title' },
            ],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      expect(result.result?.type).toBe('tasks_completed');
      // First task should fail due to message creation failure
      expect((result.result?.payload as any).results[0]).toMatchObject({
        agentId: TEST_IDS.AGENT_1_ID,
        error: 'Failed to create task message',
        success: false,
      });
      // Second task should succeed
      expect((result.result?.payload as any).results[1]).toMatchObject({
        agentId: TEST_IDS.AGENT_2_ID,
        success: true,
      });
    });

    it('should handle execSubAgentTask failure', async () => {
      const mockStore = createMockStore();

      vi.mocked(aiAgentService.execSubAgentTask)
        .mockResolvedValueOnce(
          createMockExecResult({
            error: 'Backend error',
            success: false,
          }),
        )
        .mockResolvedValueOnce(createMockExecResult({ threadId: 'thread-2' }));

      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        result: 'Task completed',
        status: 'completed',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      const result = await batchExecTasksExecutor(
        {
          payload: {
            tasks: [
              { agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' },
              { agentId: TEST_IDS.AGENT_2_ID, instruction: 'Task 2', title: 'Task 2 Title' },
            ],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      expect(result.result?.type).toBe('tasks_completed');
      // First task should fail
      expect((result.result?.payload as any).results[0]).toMatchObject({
        agentId: TEST_IDS.AGENT_1_ID,
        error: 'Backend error',
        success: false,
      });
      // Second task should succeed
      expect((result.result?.payload as any).results[1]).toMatchObject({
        agentId: TEST_IDS.AGENT_2_ID,
        success: true,
      });
    });

    it('should handle task failure status', async () => {
      const mockStore = createMockStore();

      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-1' }),
      );

      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        error: 'Task execution error',
        status: 'failed',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      const result = await batchExecTasksExecutor(
        {
          payload: {
            tasks: [{ agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' }],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      expect(result.result?.type).toBe('tasks_completed');
      expect((result.result?.payload as any).results[0]).toMatchObject({
        agentId: TEST_IDS.AGENT_1_ID,
        error: 'Task execution error',
        success: false,
      });
    });

    it('should handle operation cancellation', async () => {
      const mockStore = createMockStore();

      // Set operation to cancelled
      mockStore.operations[TEST_IDS.OPERATION_ID].status = 'cancelled';

      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-1' }),
      );

      // This should not be called since operation is cancelled
      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        status: 'processing',
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      const result = await batchExecTasksExecutor(
        {
          payload: {
            tasks: [{ agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' }],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      expect(result.newState.status).toBe('done');
      expect((result.result?.payload as any).results[0]).toMatchObject({
        agentId: TEST_IDS.AGENT_1_ID,
        error: 'Operation cancelled',
        success: false,
      });
    });

    it('should dispatch taskDetail update when task status includes taskDetail', async () => {
      const mockStore = createMockStore();
      const messageId = 'msg_1';

      vi.mocked(mockStore.optimisticCreateMessage).mockResolvedValue({
        id: messageId,
        messages: [],
      });

      vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(
        createMockExecResult({ threadId: 'thread-1' }),
      );

      // Return completed status with taskDetail in first poll
      const taskDetail = {
        status: ThreadStatus.Completed,
        threadId: 'thread-1',
        title: 'Done',
      };
      vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({
        result: 'Task completed',
        status: 'completed',
        taskDetail,
      });

      const executors = createGroupOrchestrationExecutors({
        get: () => mockStore,
        messageContext: {
          agentId: TEST_IDS.GROUP_ID,
          groupId: TEST_IDS.GROUP_ID,
          scope: 'group',
          topicId: TEST_IDS.TOPIC_ID,
        },
        orchestrationOperationId: TEST_IDS.ORCHESTRATION_OPERATION_ID,
        supervisorAgentId: TEST_IDS.SUPERVISOR_AGENT_ID,
      });

      const batchExecTasksExecutor = executors.batch_exec_async_tasks!;

      await batchExecTasksExecutor(
        {
          payload: {
            tasks: [{ agentId: TEST_IDS.AGENT_1_ID, instruction: 'Task 1', title: 'Task 1 Title' }],
            toolMessageId: TEST_IDS.TOOL_MESSAGE_ID,
          },
          type: 'batch_exec_async_tasks',
        },
        createInitialState(),
      );

      // Should dispatch message update with taskDetail
      expect(mockStore.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: messageId,
          type: 'updateMessage',
          value: { taskDetail },
        }),
        expect.objectContaining({ operationId: TEST_IDS.OPERATION_ID }),
      );
    });
  });
});
