import { type AgentRuntimeContext, type TasksBatchResultPayload } from '@lobechat/agent-runtime';
import { type Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';

import { createExecTasksInstruction } from './fixtures';
import { createMockStore } from './fixtures/mockStore';
import { createInitialState, createTestContext, executeWithMockContext } from './helpers';

// Mock aiAgentService
vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execSubAgentTask: vi.fn(),
    getSubAgentTaskStatus: vi.fn(),
  },
}));

// Helper to get typed mocks
const mockExecSubAgentTask = aiAgentService.execSubAgentTask as Mock;
const mockGetSubAgentTaskStatus = aiAgentService.getSubAgentTaskStatus as Mock;

describe('exec_tasks executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Behavior', () => {
    it('should execute single task successfully', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction(
        [{ description: 'Test task 1', instruction: 'Do something' }],
        'msg_parent',
      );
      const state = createInitialState({ operationId: 'test-op' });

      // Mock task message creation
      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      // Mock task execution
      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      // Mock task status polling - completed on first poll
      mockGetSubAgentTaskStatus.mockResolvedValueOnce({
        result: 'Task completed successfully',
        status: 'completed',
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      expect((result.nextContext as AgentRuntimeContext).phase).toBe('tasks_batch_result');

      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].success).toBe(true);
      expect(payload.results[0].threadId).toBe('thread_1');
      expect(payload.results[0].taskMessageId).toBe('task_msg_1');
    });

    it('should execute multiple tasks in parallel', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction(
        [
          { description: 'Task 1', instruction: 'Do task 1' },
          { description: 'Task 2', instruction: 'Do task 2' },
          { description: 'Task 3', instruction: 'Do task 3' },
        ],
        'msg_parent',
      );
      const state = createInitialState({ operationId: 'test-op' });

      // Mock task message creation for each task
      (mockStore.optimisticCreateMessage as Mock)
        .mockResolvedValueOnce({ id: 'task_msg_1' })
        .mockResolvedValueOnce({ id: 'task_msg_2' })
        .mockResolvedValueOnce({ id: 'task_msg_3' });

      // Mock task execution for each task
      mockExecSubAgentTask
        .mockResolvedValueOnce({
          assistantMessageId: 'asst_1',
          operationId: 'op_1',
          success: true,
          threadId: 'thread_1',
        })
        .mockResolvedValueOnce({
          assistantMessageId: 'asst_2',
          operationId: 'op_2',
          success: true,
          threadId: 'thread_2',
        })
        .mockResolvedValueOnce({
          assistantMessageId: 'asst_3',
          operationId: 'op_3',
          success: true,
          threadId: 'thread_3',
        });

      // Mock task status polling - all completed
      mockGetSubAgentTaskStatus
        .mockResolvedValueOnce({ result: 'Result 1', status: 'completed' })
        .mockResolvedValueOnce({ result: 'Result 2', status: 'completed' })
        .mockResolvedValueOnce({ result: 'Result 3', status: 'completed' });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results).toHaveLength(3);
      expect(payload.results.every((r) => r.success)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return error when no context available', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: undefined, topicId: null });
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      // Override operation context to have no agentId/topicId
      mockStore.operations[context.operationId] = {
        abortController: new AbortController(),
        childOperationIds: [],
        context: {
          agentId: undefined,
          topicId: undefined,
        },
        id: context.operationId,
        metadata: { startTime: Date.now() },
        status: 'running',
        type: 'execAgentRuntime',
      };

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].success).toBe(false);
      expect(payload.results[0].error).toBe('No valid context available');
    });

    it('should handle task message creation failure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      // Mock task message creation failure
      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce(null);

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results[0].success).toBe(false);
      expect(payload.results[0].error).toBe('Failed to create task message');
    });

    it('should handle task creation API failure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: '',
        error: 'API error',
        operationId: '',
        success: false,
        threadId: '',
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results[0].success).toBe(false);
      expect(payload.results[0].error).toBe('API error');
      expect(mockStore.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'task_msg_1',
        'Task creation failed: API error',
        undefined,
        { operationId: 'test-op' },
      );
    });

    it('should handle task execution failure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      mockGetSubAgentTaskStatus.mockResolvedValueOnce({
        error: 'Execution error',
        status: 'failed',
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results[0].success).toBe(false);
      expect(payload.results[0].error).toBe('Execution error');
    });
  });

  describe('Task Status Polling', () => {
    it('should update task message with taskDetail when completed', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      // Return completed with taskDetail on first poll
      mockGetSubAgentTaskStatus.mockResolvedValueOnce({
        result: 'Done',
        status: 'completed',
        taskDetail: { status: 'completed' },
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(mockStore.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'task_msg_1',
          type: 'updateMessage',
          value: { taskDetail: { status: 'completed' } },
        },
        { operationId: 'test-op' },
      );
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results[0].success).toBe(true);
    });

    it('should handle cancelled task status', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      // Use mockImplementationOnce to ensure fresh mock behavior
      mockGetSubAgentTaskStatus.mockImplementationOnce(async () => ({
        status: 'cancel',
      }));

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results[0].success).toBe(false);
      expect(payload.results[0].error).toBe('Task was cancelled');
      expect(mockStore.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'task_msg_1',
        'Task was cancelled',
        undefined,
        { operationId: 'test-op' },
      );
    });
  });

  describe('Operation Cancellation', () => {
    it('should stop polling when operation is cancelled before poll', async () => {
      // Given
      const mockStore = createMockStore();
      // Use same operationId for both context and state
      const operationId = 'test-op';
      const context = createTestContext({ operationId });
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ operationId });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      // Mock execSubAgentTask to mark operation as cancelled after it's called
      // This simulates cancellation happening right after task creation but before polling
      mockExecSubAgentTask.mockImplementation(async () => {
        // After task creation API is called, mark operation as cancelled
        // This simulates cancellation happening right after task creation
        // Note: state.operationId is used in the polling loop for cancellation check
        mockStore.operations[operationId].status = 'cancelled';
        return {
          assistantMessageId: 'asst_1',
          operationId: 'op_1',
          success: true,
          threadId: 'thread_1',
        };
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results[0].success).toBe(false);
      expect(payload.results[0].error).toBe('Operation cancelled');
      // getSubAgentTaskStatus should not be called since operation was cancelled before poll
      expect(mockGetSubAgentTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe('Result Phase', () => {
    it('should return tasks_result phase with correct session info', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction(
        [{ description: 'Test', instruction: 'Test instruction' }],
        'msg_parent',
      );
      const state = createInitialState({ operationId: 'test-op', stepCount: 5 });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      mockGetSubAgentTaskStatus.mockResolvedValueOnce({
        result: 'Done',
        status: 'completed',
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      const nextContext = result.nextContext as AgentRuntimeContext;
      expect(nextContext.phase).toBe('tasks_batch_result');
      expect(nextContext.session?.stepCount).toBe(6);
      expect(nextContext.session?.status).toBe('running');

      const payload = nextContext.payload as TasksBatchResultPayload;
      expect(payload.parentMessageId).toBe('msg_parent');
    });

    it('should update messages in newState from store', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction();
      const state = createInitialState({ messages: [], operationId: 'test-op' });

      const updatedMessages = [{ content: 'test', id: 'msg_1', role: 'user' }];
      mockStore.dbMessagesMap[context.messageKey] = updatedMessages as any;

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      mockGetSubAgentTaskStatus.mockResolvedValueOnce({
        result: 'Done',
        status: 'completed',
      });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.newState.messages).toEqual(updatedMessages);
    });
  });

  describe('Task Message Creation', () => {
    it('should create task message with correct parameters', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: 'agent_1', topicId: 'topic_1' });
      const instruction = createExecTasksInstruction(
        [{ description: 'Test task', instruction: 'Do something important' }],
        'msg_parent',
      );
      const state = createInitialState({ operationId: 'test-op' });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      mockExecSubAgentTask.mockResolvedValueOnce({
        assistantMessageId: 'asst_1',
        operationId: 'op_1',
        success: true,
        threadId: 'thread_1',
      });

      mockGetSubAgentTaskStatus.mockResolvedValueOnce({
        result: 'Done',
        status: 'completed',
      });

      // When
      await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        {
          agentId: 'agent_1',
          content: '',
          createdAt: expect.any(Number),
          metadata: { instruction: 'Do something important' },
          parentId: 'msg_parent',
          role: 'task',
          topicId: 'topic_1',
        },
        { operationId: 'test-op' },
      );
    });
  });

  describe('Mixed Results', () => {
    it('should handle mix of successful and failed tasks', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTasksInstruction(
        [
          { description: 'Task 1', instruction: 'Success task' },
          { description: 'Task 2', instruction: 'Fail task' },
        ],
        'msg_parent',
      );
      const state = createInitialState({ operationId: 'test-op' });

      (mockStore.optimisticCreateMessage as Mock)
        .mockResolvedValueOnce({ id: 'task_msg_1' })
        .mockResolvedValueOnce({ id: 'task_msg_2' });

      mockExecSubAgentTask
        .mockResolvedValueOnce({
          assistantMessageId: 'asst_1',
          operationId: 'op_1',
          success: true,
          threadId: 'thread_1',
        })
        .mockResolvedValueOnce({
          assistantMessageId: 'asst_2',
          operationId: 'op_2',
          success: true,
          threadId: 'thread_2',
        });

      mockGetSubAgentTaskStatus
        .mockResolvedValueOnce({ result: 'Success', status: 'completed' })
        .mockResolvedValueOnce({ error: 'Task failed', status: 'failed' });

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_tasks',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext)
        .payload as TasksBatchResultPayload;
      expect(payload.results).toHaveLength(2);
      expect(payload.results[0].success).toBe(true);
      expect(payload.results[1].success).toBe(false);
      expect(payload.results[1].error).toBe('Task failed');
    });
  });
});
