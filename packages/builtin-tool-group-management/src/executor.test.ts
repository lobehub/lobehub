import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuiltinToolContext } from '../../types';
import { groupManagementExecutor } from './executor';

// Mock agentGroupStore
vi.mock('@/store/agentGroup', () => ({
  agentGroupSelectors: {
    getAgentByIdFromGroup: vi.fn(() => () => undefined),
  },
  useAgentGroupStore: {
    getState: () => ({}),
  },
}));

// Mock the aiAgent service the interrupt API dynamically imports
const mockInterruptTask = vi.fn();

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    interruptTask: (...args: any[]) => mockInterruptTask(...args),
  },
}));

describe('GroupManagementExecutor', () => {
  const createMockContext = (agentId?: string): BuiltinToolContext => ({
    agentId,
    messageId: 'test-message-id',
    operationId: 'test-operation-id',
  });

  describe('speak', () => {
    it('should return stop=true to terminate supervisor execution', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.speak(
        { agentId: 'agent-1', instruction: 'Please respond' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.state).toEqual({
        agentId: 'agent-1',
        instruction: 'Please respond',
        type: 'speak',
      });
    });
  });

  describe('broadcast', () => {
    it('should return stop=true to terminate supervisor execution', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.broadcast(
        { agentIds: ['agent-1', 'agent-2'], instruction: 'Discuss' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.state).toEqual({
        agentIds: ['agent-1', 'agent-2'],
        instruction: 'Discuss',
        type: 'broadcast',
      });
    });
  });

  describe('delegate', () => {
    it('should return stop=true to terminate supervisor execution', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.delegate(
        { agentId: 'agent-1', reason: 'User requested' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.state).toEqual({
        agentId: 'agent-1',
        reason: 'User requested',
        type: 'delegate',
      });
    });
  });

  describe('executeAgentTask', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return stop=true to terminate supervisor execution', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeAgentTask(
        { agentId: 'agent-1', instruction: 'Do something', title: 'Test Task' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.content).toBe('Triggered async task for agent "agent-1".');
      expect(result.state).toEqual({
        agentId: 'agent-1',
        instruction: 'Do something',
        timeout: undefined,
        type: 'executeAgentTask',
      });
    });

    it('should include timeout in state when provided', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeAgentTask(
        { agentId: 'agent-1', instruction: 'Do something', timeout: 60000, title: 'Test Task' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state).toEqual({
        agentId: 'agent-1',
        instruction: 'Do something',
        timeout: 60000,
        type: 'executeAgentTask',
      });
    });
  });

  describe('executeAgentTasks', () => {
    it('should return stop=true with every task in state', async () => {
      const ctx = createMockContext('supervisor-agent');
      const tasks = [
        { agentId: 'agent-1', instruction: 'Research', title: 'Task 1' },
        { agentId: 'agent-2', instruction: 'Write', title: 'Task 2' },
      ];

      const result = await groupManagementExecutor.executeAgentTasks({ tasks }, ctx);

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.content).toBe('Triggered 2 parallel tasks for agents: agent-1, agent-2.');
      expect(result.state).toEqual({
        skipCallSupervisor: undefined,
        tasks,
        type: 'executeAgentTasks',
      });
    });
  });

  describe('interrupt', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should successfully interrupt a running task', async () => {
      mockInterruptTask.mockResolvedValue({
        operationId: 'op-123',
        success: true,
      });

      const ctx = createMockContext();

      const result = await groupManagementExecutor.interrupt({ taskId: 'thread-123' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Task thread-123 has been cancelled successfully');
      expect(result.state).toEqual({
        cancelled: true,
        operationId: 'op-123',
        taskId: 'thread-123',
      });
      expect(mockInterruptTask).toHaveBeenCalledWith({
        threadId: 'thread-123',
      });
    });

    it('should handle failed interrupt attempt', async () => {
      mockInterruptTask.mockResolvedValue({
        success: false,
      });

      const ctx = createMockContext();

      const result = await groupManagementExecutor.interrupt({ taskId: 'thread-123' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to cancel task thread-123');
      expect(result.state).toEqual({
        cancelled: false,
        taskId: 'thread-123',
      });
    });

    it('should handle API errors gracefully', async () => {
      mockInterruptTask.mockRejectedValue(new Error('Task not found'));

      const ctx = createMockContext();

      const result = await groupManagementExecutor.interrupt({ taskId: 'thread-123' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to interrupt task: Task not found');
    });
  });
});
