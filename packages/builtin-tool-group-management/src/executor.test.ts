import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AfterCompletionCallback,
  BuiltinToolContext,
  GroupOrchestrationCallbacks,
} from '../../types';
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

// Mock lambdaClient for Task APIs
const mockExecGroupSubAgentTask = vi.fn();
const mockGetTaskStatus = vi.fn();
const mockInterruptTask = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      execGroupSubAgentTask: { mutate: (...args: any[]) => mockExecGroupSubAgentTask(...args) },
      getGroupSubAgentTaskStatus: { query: (...args: any[]) => mockGetTaskStatus(...args) },
      interruptTask: { mutate: (...args: any[]) => mockInterruptTask(...args) },
    },
  },
}));

describe('GroupManagementExecutor', () => {
  const createMockContext = (
    groupOrchestration?: GroupOrchestrationCallbacks,
    agentId?: string,
    registerAfterCompletion?: (callback: AfterCompletionCallback) => void,
  ): BuiltinToolContext => ({
    agentId,
    groupOrchestration,
    messageId: 'test-message-id',
    operationId: 'test-operation-id',
    registerAfterCompletion,
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

    it('should register afterCompletion callback that triggers groupOrchestration.triggerSpeak', async () => {
      const triggerSpeak = vi.fn();
      const registeredCallbacks: AfterCompletionCallback[] = [];
      const registerAfterCompletion = vi.fn((cb: AfterCompletionCallback) => {
        registeredCallbacks.push(cb);
      });

      const ctx = createMockContext(
        {
          triggerBroadcast: vi.fn(),
          triggerDelegate: vi.fn(),
          triggerExecuteTask: vi.fn(),
          triggerSpeak,
        },
        'supervisor-agent',
        registerAfterCompletion,
      );

      await groupManagementExecutor.speak(
        { agentId: 'agent-1', instruction: 'Please respond' },
        ctx,
      );

      // Verify registerAfterCompletion was called
      expect(registerAfterCompletion).toHaveBeenCalled();
      expect(registeredCallbacks.length).toBe(1);

      // Execute the registered callback (simulating AgentRuntime completion)
      await registeredCallbacks[0]();

      // Now triggerSpeak should have been called
      expect(triggerSpeak).toHaveBeenCalledWith({
        agentId: 'agent-1',
        instruction: 'Please respond',
        supervisorAgentId: 'supervisor-agent',
      });
    });

    it('should not fail when groupOrchestration is not available', async () => {
      const ctx = createMockContext(); // No groupOrchestration

      const result = await groupManagementExecutor.speak({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
    });

    it('should handle undefined instruction in afterCompletion callback', async () => {
      const triggerSpeak = vi.fn();
      const registeredCallbacks: AfterCompletionCallback[] = [];
      const registerAfterCompletion = vi.fn((cb: AfterCompletionCallback) => {
        registeredCallbacks.push(cb);
      });

      const ctx = createMockContext(
        {
          triggerBroadcast: vi.fn(),
          triggerDelegate: vi.fn(),
          triggerExecuteTask: vi.fn(),
          triggerSpeak,
        },
        'supervisor-agent',
        registerAfterCompletion,
      );

      await groupManagementExecutor.speak({ agentId: 'agent-2' }, ctx);

      // Execute the registered callback
      await registeredCallbacks[0]();

      expect(triggerSpeak).toHaveBeenCalledWith({
        agentId: 'agent-2',
        instruction: undefined,
        supervisorAgentId: 'supervisor-agent',
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

    it('should register afterCompletion callback that triggers groupOrchestration.triggerBroadcast', async () => {
      const triggerBroadcast = vi.fn();
      const registeredCallbacks: AfterCompletionCallback[] = [];
      const registerAfterCompletion = vi.fn((cb: AfterCompletionCallback) => {
        registeredCallbacks.push(cb);
      });

      const ctx = createMockContext(
        {
          triggerBroadcast,
          triggerDelegate: vi.fn(),
          triggerExecuteTask: vi.fn(),
          triggerSpeak: vi.fn(),
        },
        'supervisor-agent',
        registerAfterCompletion,
      );

      await groupManagementExecutor.broadcast(
        { agentIds: ['agent-1', 'agent-2'], instruction: 'Discuss together' },
        ctx,
      );

      // Verify registerAfterCompletion was called
      expect(registerAfterCompletion).toHaveBeenCalled();
      expect(registeredCallbacks.length).toBe(1);

      // Execute the registered callback (simulating AgentRuntime completion)
      await registeredCallbacks[0]();

      // Now triggerBroadcast should have been called
      expect(triggerBroadcast).toHaveBeenCalledWith({
        agentIds: ['agent-1', 'agent-2'],
        instruction: 'Discuss together',
        supervisorAgentId: 'supervisor-agent',
        toolMessageId: 'test-message-id',
      });
    });

    it('should not fail when groupOrchestration is not available', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.broadcast({ agentIds: ['agent-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
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

    it('should register afterCompletion callback that triggers groupOrchestration.triggerDelegate', async () => {
      const triggerDelegate = vi.fn();
      const registeredCallbacks: AfterCompletionCallback[] = [];
      const registerAfterCompletion = vi.fn((cb: AfterCompletionCallback) => {
        registeredCallbacks.push(cb);
      });

      const ctx = createMockContext(
        {
          triggerBroadcast: vi.fn(),
          triggerDelegate,
          triggerExecuteTask: vi.fn(),
          triggerSpeak: vi.fn(),
        },
        'supervisor-agent',
        registerAfterCompletion,
      );

      await groupManagementExecutor.delegate({ agentId: 'agent-3', reason: 'Expert needed' }, ctx);

      // Verify registerAfterCompletion was called
      expect(registerAfterCompletion).toHaveBeenCalled();
      expect(registeredCallbacks.length).toBe(1);

      // Execute the registered callback (simulating AgentRuntime completion)
      await registeredCallbacks[0]();

      // Now triggerDelegate should have been called
      expect(triggerDelegate).toHaveBeenCalledWith({
        agentId: 'agent-3',
        reason: 'Expert needed',
        supervisorAgentId: 'supervisor-agent',
      });
    });

    it('should not fail when groupOrchestration is not available', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.delegate({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
    });
  });

  describe('getAgentInfo', () => {
    it('should return error when no groupId in context', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.getAgentInfo({ agentId: 'agent-1' }, ctx);

      // No groupId means we can't get agent info
      expect(result.success).toBe(false);
      expect(result.stop).toBeUndefined();
    });
  });

  describe('executeAgentTask', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return stop=true to terminate supervisor execution', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeAgentTask(
        { agentId: 'agent-1', task: 'Do something' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.content).toBe('Triggered async task for agent "agent-1".');
      expect(result.state).toEqual({
        agentId: 'agent-1',
        task: 'Do something',
        timeout: undefined,
        type: 'executeAgentTask',
      });
    });

    it('should register afterCompletion callback that triggers groupOrchestration.triggerExecuteTask', async () => {
      const triggerExecuteTask = vi.fn();
      const registeredCallbacks: AfterCompletionCallback[] = [];
      const registerAfterCompletion = vi.fn((cb: AfterCompletionCallback) => {
        registeredCallbacks.push(cb);
      });

      const ctx = createMockContext(
        {
          triggerBroadcast: vi.fn(),
          triggerDelegate: vi.fn(),
          triggerExecuteTask,
          triggerSpeak: vi.fn(),
        },
        'supervisor-agent',
        registerAfterCompletion,
      );

      await groupManagementExecutor.executeAgentTask(
        { agentId: 'agent-1', task: 'Do something', timeout: 30000 },
        ctx,
      );

      // Verify registerAfterCompletion was called
      expect(registerAfterCompletion).toHaveBeenCalled();
      expect(registeredCallbacks.length).toBe(1);

      // Execute the registered callback (simulating AgentRuntime completion)
      await registeredCallbacks[0]();

      // Now triggerExecuteTask should have been called
      expect(triggerExecuteTask).toHaveBeenCalledWith({
        agentId: 'agent-1',
        supervisorAgentId: 'supervisor-agent',
        task: 'Do something',
        timeout: 30000,
        toolMessageId: 'test-message-id',
      });
    });

    it('should not fail when groupOrchestration is not available', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeAgentTask(
        { agentId: 'agent-1', task: 'Do something' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
    });

    it('should include timeout in state when provided', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeAgentTask(
        { agentId: 'agent-1', task: 'Do something', timeout: 60000 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state).toEqual({
        agentId: 'agent-1',
        task: 'Do something',
        timeout: 60000,
        type: 'executeAgentTask',
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
