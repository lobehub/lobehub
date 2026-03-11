import { type AgentRuntimeContext, type TaskResultPayload } from '@lobechat/agent-runtime';
import { type Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';

import { createExecTaskInstruction } from './fixtures';
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

describe('exec_task executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Behavior', () => {
    it('should execute single task successfully', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction(
        { description: 'Test task', instruction: 'Do something' },
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      expect((result.nextContext as AgentRuntimeContext).phase).toBe('task_result');

      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result).toBeDefined();
      expect(payload.result.success).toBe(true);
      expect(payload.result.threadId).toBe('thread_1');
      expect(payload.result.taskMessageId).toBe('task_msg_1');
    });
  });

  describe('Error Handling', () => {
    it('should return error when no context available', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext({ agentId: undefined, topicId: null });
      const instruction = createExecTaskInstruction();
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(false);
      expect(payload.result.error).toBe('No valid context available');
    });

    it('should handle task message creation failure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction();
      const state = createInitialState({ operationId: 'test-op' });

      // Mock task message creation failure
      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce(null);

      // When
      const result = await executeWithMockContext({
        context,
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(false);
      expect(payload.result.error).toBe('Failed to create task message');
    });

    it('should handle task creation API failure', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction();
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(false);
      expect(payload.result.error).toBe('API error');
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
      const instruction = createExecTaskInstruction();
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(false);
      expect(payload.result.error).toBe('Execution error');
    });
  });

  describe('Task Status Polling', () => {
    it('should update task message with taskDetail when completed', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction();
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
        executor: 'exec_task',
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
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(true);
    });

    it('should handle cancelled task status', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction();
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(false);
      expect(payload.result.error).toBe('Task was cancelled');
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
      const instruction = createExecTaskInstruction();
      const state = createInitialState({ operationId });

      (mockStore.optimisticCreateMessage as Mock).mockResolvedValueOnce({ id: 'task_msg_1' });

      // Mock execSubAgentTask to mark operation as cancelled after it's called
      // This simulates cancellation happening right after task creation but before polling
      mockExecSubAgentTask.mockImplementation(async () => {
        // After task creation API is called, mark operation as cancelled
        // This simulates cancellation happening right after task creation
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      const payload = (result.nextContext as AgentRuntimeContext).payload as TaskResultPayload;
      expect(payload.result.success).toBe(false);
      expect(payload.result.error).toBe('Operation cancelled');
      // getSubAgentTaskStatus should not be called since operation was cancelled before poll
      expect(mockGetSubAgentTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe('Result Phase', () => {
    it('should return task_result phase with correct session info', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction(
        { description: 'Test', instruction: 'Test instruction' },
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(result.nextContext).toBeDefined();
      const nextContext = result.nextContext as AgentRuntimeContext;
      expect(nextContext.phase).toBe('task_result');
      expect(nextContext.session?.stepCount).toBe(6);
      expect(nextContext.session?.status).toBe('running');

      const payload = nextContext.payload as TaskResultPayload;
      expect(payload.parentMessageId).toBe('msg_parent');
    });

    it('should update messages in newState from store', async () => {
      // Given
      const mockStore = createMockStore();
      const context = createTestContext();
      const instruction = createExecTaskInstruction();
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
        executor: 'exec_task',
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
      const instruction = createExecTaskInstruction(
        { description: 'Test task', instruction: 'Do something important' },
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
        executor: 'exec_task',
        instruction,
        mockStore,
        state,
      });

      // Then
      expect(mockStore.optimisticCreateMessage).toHaveBeenCalledWith(
        {
          agentId: 'agent_1',
          content: '',
          metadata: { instruction: 'Do something important', taskTitle: 'Test task' },
          parentId: 'msg_parent',
          role: 'task',
          topicId: 'topic_1',
        },
        { operationId: 'test-op' },
      );
    });
  });
});
