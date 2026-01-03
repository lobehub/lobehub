import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AfterCompletionCallback,
  BuiltinToolContext,
  GroupOrchestrationCallbacks,
} from '../../types';
import { groupManagementExecutor } from './executor';

// Mock agentGroupStore
const mockAddAgentsToGroup = vi.fn();
const mockRemoveAgentFromGroup = vi.fn();

vi.mock('@/store/agentGroup', () => ({
  agentGroupSelectors: {
    getAgentByIdFromGroup: vi.fn(() => () => undefined),
  },
  useAgentGroupStore: {
    getState: () => ({
      addAgentsToGroup: mockAddAgentsToGroup,
      removeAgentFromGroup: mockRemoveAgentFromGroup,
    }),
  },
}));

// Mock agentService
const mockQueryAgents = vi.fn();
const mockCreateAgent = vi.fn();

vi.mock('@/services/agent', () => ({
  agentService: {
    createAgent: (...args: any[]) => mockCreateAgent(...args),
    queryAgents: (...args: any[]) => mockQueryAgents(...args),
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

  describe('searchAgent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return community not supported message when source is community', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.searchAgent(
        { query: 'test', source: 'community' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('Community agent search is not yet supported');
      expect(result.state).toEqual({ agents: [], source: 'community', total: 0 });
    });

    it('should search user agents and return formatted results', async () => {
      mockQueryAgents.mockResolvedValue([
        { id: 'agent-1', title: 'Code Assistant', description: 'Helps with coding', avatar: '🤖' },
        { id: 'agent-2', title: 'Writer', description: null, avatar: null },
      ]);

      const ctx = createMockContext();
      const result = await groupManagementExecutor.searchAgent({ query: 'test' }, ctx);

      expect(result.success).toBe(true);
      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: 'test', limit: 10 });
      expect(result.content).toContain('Found 2 agents');
      expect(result.content).toContain('Code Assistant');
      expect(result.content).toContain('Writer');
      expect(result.state.agents).toHaveLength(2);
      expect(result.state.total).toBe(2);
    });

    it('should return no results message when no agents found', async () => {
      mockQueryAgents.mockResolvedValue([]);

      const ctx = createMockContext();
      const result = await groupManagementExecutor.searchAgent({ query: 'nonexistent' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('No agents found matching "nonexistent"');
      expect(result.state).toEqual({ agents: [], query: 'nonexistent', total: 0 });
    });

    it('should pass limit to queryAgents', async () => {
      mockQueryAgents.mockResolvedValue([
        { id: 'agent-1', title: 'Agent 1' },
        { id: 'agent-2', title: 'Agent 2' },
      ]);

      const ctx = createMockContext();
      const result = await groupManagementExecutor.searchAgent({ query: 'test', limit: 2 }, ctx);

      expect(result.success).toBe(true);
      expect(mockQueryAgents).toHaveBeenCalledWith({ keyword: 'test', limit: 2 });
      expect(result.state.agents).toHaveLength(2);
    });

    it('should handle errors gracefully', async () => {
      mockQueryAgents.mockRejectedValue(new Error('Network error'));

      const ctx = createMockContext();
      const result = await groupManagementExecutor.searchAgent({ query: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to search agents: Network error');
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

  describe('inviteAgent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return error when no groupId in context', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.inviteAgent({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('No group context available');
    });

    it('should successfully invite agent when groupId is available', async () => {
      mockAddAgentsToGroup.mockResolvedValue(undefined);

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.inviteAgent({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(true);
      expect(mockAddAgentsToGroup).toHaveBeenCalledWith('test-group-id', ['agent-1']);
      expect(result.content).toBe('Agent "agent-1" has been invited to the group.');
      expect(result.state).toEqual({ agentId: 'agent-1', type: 'inviteAgent' });
    });

    it('should handle errors during invitation', async () => {
      mockAddAgentsToGroup.mockRejectedValue(new Error('Database error'));

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.inviteAgent({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to invite agent "agent-1": Database error');
    });
  });

  describe('removeAgent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return error when no groupId in context', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.removeAgent({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('No group context available');
    });

    it('should successfully remove agent when groupId is available', async () => {
      mockRemoveAgentFromGroup.mockResolvedValue(undefined);

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.removeAgent({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(true);
      expect(mockRemoveAgentFromGroup).toHaveBeenCalledWith('test-group-id', 'agent-1');
      expect(result.content).toBe('Agent "agent-1" has been removed from the group.');
      expect(result.state).toEqual({ agentId: 'agent-1', type: 'removeAgent' });
    });

    it('should handle errors during removal', async () => {
      mockRemoveAgentFromGroup.mockRejectedValue(new Error('Agent not found'));

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.removeAgent({ agentId: 'agent-1' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to remove agent "agent-1": Agent not found');
    });
  });

  describe('createAgent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return error when no groupId in context', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.createAgent(
        { title: 'New Agent', systemRole: 'You are a helpful assistant' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe('No group context available');
    });

    it('should successfully create a virtual agent and add to group', async () => {
      mockCreateAgent.mockResolvedValue({
        agentId: 'new-agent-id',
        sessionId: 'new-session-id',
      });

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.createAgent(
        {
          avatar: '🤖',
          description: 'A helpful coding assistant',
          systemRole: 'You are a coding expert',
          title: 'Code Helper',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(mockCreateAgent).toHaveBeenCalledWith({
        config: {
          avatar: '🤖',
          description: 'A helpful coding assistant',
          systemRole: 'You are a coding expert',
          title: 'Code Helper',
          virtual: true,
        },
        groupId: 'test-group-id',
      });
      expect(result.content).toBe('Agent "Code Helper" has been created and added to the group.');
      expect(result.state).toEqual({
        agentId: 'new-agent-id',
        title: 'Code Helper',
        type: 'createAgent',
      });
    });

    it('should handle case when agentId is not returned', async () => {
      mockCreateAgent.mockResolvedValue({
        sessionId: 'new-session-id',
        // No agentId returned
      });

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.createAgent(
        { title: 'New Agent', systemRole: 'Test' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to create agent: No agent ID returned');
    });

    it('should handle errors during creation', async () => {
      mockCreateAgent.mockRejectedValue(new Error('Database connection failed'));

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.createAgent(
        { title: 'New Agent', systemRole: 'Test' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to create agent: Database connection failed');
    });

    it('should create agent with minimal params (only required fields)', async () => {
      mockCreateAgent.mockResolvedValue({
        agentId: 'minimal-agent-id',
        sessionId: 'minimal-session-id',
      });

      const ctx: BuiltinToolContext = {
        ...createMockContext(),
        groupId: 'test-group-id',
      };

      const result = await groupManagementExecutor.createAgent(
        { title: 'Minimal Agent', systemRole: 'Basic assistant' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(mockCreateAgent).toHaveBeenCalledWith({
        config: {
          avatar: undefined,
          description: undefined,
          systemRole: 'Basic assistant',
          title: 'Minimal Agent',
          virtual: true,
        },
        groupId: 'test-group-id',
      });
    });
  });

  describe('executeTask', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return stop=true to terminate supervisor execution', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeTask(
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
        type: 'executeTask',
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

      await groupManagementExecutor.executeTask(
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

      const result = await groupManagementExecutor.executeTask(
        { agentId: 'agent-1', task: 'Do something' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.stop).toBe(true);
    });

    it('should include timeout in state when provided', async () => {
      const ctx = createMockContext();

      const result = await groupManagementExecutor.executeTask(
        { agentId: 'agent-1', task: 'Do something', timeout: 60000 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.state).toEqual({
        agentId: 'agent-1',
        task: 'Do something',
        timeout: 60000,
        type: 'executeTask',
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
