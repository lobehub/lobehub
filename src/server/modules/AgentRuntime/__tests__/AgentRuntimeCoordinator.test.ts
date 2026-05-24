import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeCoordinator } from '../AgentRuntimeCoordinator';
import { createAgentStateManager, createStreamEventManager } from '../factory';

// Mock factory module to avoid Redis/env access
vi.mock('../factory', () => ({
  createAgentStateManager: vi.fn(),
  createStreamEventManager: vi.fn(),
  isRedisAvailable: vi.fn(() => false),
}));

describe('AgentRuntimeCoordinator', () => {
  let coordinator: AgentRuntimeCoordinator;
  let mockStateManager: any;
  let mockStreamManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStateManager = {
      cleanupExpiredOperations: vi.fn(),
      createOperationMetadata: vi.fn(),
      deleteAgentOperation: vi.fn(),
      disconnect: vi.fn(),
      getActiveOperations: vi.fn(),
      getExecutionHistory: vi.fn(),
      getOperationMetadata: vi.fn(),
      getStats: vi.fn(),
      loadAgentState: vi.fn(),
      saveAgentState: vi.fn(),
      saveStepResult: vi.fn(),
    };

    mockStreamManager = {
      cleanupOperation: vi.fn(),
      disconnect: vi.fn(),
      publishAgentRuntimeEnd: vi.fn(),
      publishAgentRuntimeInit: vi.fn(),
      publishStreamEvent: vi.fn(),
    };

    vi.mocked(createAgentStateManager).mockReturnValue(mockStateManager);
    vi.mocked(createStreamEventManager).mockReturnValue(mockStreamManager);

    coordinator = new AgentRuntimeCoordinator();
  });

  describe('createAgentOperation', () => {
    it('should create operation metadata and publish init event', async () => {
      const operationId = 'test-operation-id';
      const data = {
        agentConfig: { test: true },
        modelRuntimeConfig: { model: 'gpt-4' },
        userId: 'user-123',
      };
      const metadata = {
        createdAt: '2024-01-01T00:00:00.000Z',
        status: 'idle',
        totalCost: 0,
        totalSteps: 0,
        ...data,
      };

      mockStateManager.getOperationMetadata.mockResolvedValue(metadata);

      await coordinator.createAgentOperation(operationId, data);

      expect(mockStateManager.createOperationMetadata).toHaveBeenCalledWith(operationId, data);
      expect(mockStateManager.getOperationMetadata).toHaveBeenCalledWith(operationId);
      expect(mockStreamManager.publishAgentRuntimeInit).toHaveBeenCalledWith(operationId, metadata);
    });

    it('should not publish init event if metadata creation fails', async () => {
      const operationId = 'test-operation-id';
      const data = { userId: 'user-123' };

      mockStateManager.getOperationMetadata.mockResolvedValue(null);

      await coordinator.createAgentOperation(operationId, data);

      expect(mockStateManager.createOperationMetadata).toHaveBeenCalledWith(operationId, data);
      expect(mockStreamManager.publishAgentRuntimeInit).not.toHaveBeenCalled();
    });
  });

  describe('saveAgentState', () => {
    it('should save state and publish end event when status changes to done', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'done', stepCount: 5 };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStateManager.saveAgentState).toHaveBeenCalledWith(operationId, newState);
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId,
        reason: 'done',
        stepIndex: newState.stepCount,
        uiMessages: undefined,
      });
    });

    it('should publish end event when status changes to error', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'running', stepCount: 3 };
      const newState = { error: { message: 'boom' }, status: 'error', stepCount: 5 };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId,
        reason: 'error',
        stepIndex: newState.stepCount,
        uiMessages: undefined,
      });
    });

    it('should fallback to previous stepCount when terminal state is missing stepCount', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'running', stepCount: 3 };
      const newState = { error: { message: 'boom' }, status: 'error' };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId,
        reason: 'error',
        stepIndex: previousState.stepCount,
        uiMessages: undefined,
      });
    });

    it('should publish end event when status changes to interrupted', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'interrupted', stepCount: 5 };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId,
        reason: 'interrupted',
        stepIndex: newState.stepCount,
        uiMessages: undefined,
      });
    });

    it('should publish end event when status changes to waiting_for_human so the client releases its loading state', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'waiting_for_human', stepCount: 4 };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId,
        reason: 'waiting_for_human',
        stepIndex: newState.stepCount,
        uiMessages: undefined,
      });
    });

    it('should not publish end event when status was already done', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'done', stepCount: 5 };
      const newState = { status: 'error', stepCount: 5 };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStateManager.saveAgentState).toHaveBeenCalledWith(operationId, newState);
      expect(mockStreamManager.publishAgentRuntimeEnd).not.toHaveBeenCalled();
    });

    it('should not publish end event when status is not done', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'idle', stepCount: 0 };
      const newState = { status: 'running', stepCount: 1 };

      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState(operationId, newState as any);

      expect(mockStateManager.saveAgentState).toHaveBeenCalledWith(operationId, newState);
      expect(mockStreamManager.publishAgentRuntimeEnd).not.toHaveBeenCalled();
    });
  });

  describe('saveStepResult', () => {
    it('should save step result and publish end event when status becomes done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: { status: 'done', stepCount: 5 },
        stepIndex: 5,
      };

      // Mock previous state as running
      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 4 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStateManager.loadAgentState).toHaveBeenCalledWith(operationId);
      expect(mockStateManager.saveStepResult).toHaveBeenCalledWith(operationId, stepResult);
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId,
        reason: 'done',
        stepIndex: 5,
        uiMessages: undefined,
      });
    });

    it('should publish end event when status becomes error', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: { error: { message: 'boom' }, status: 'error', stepCount: 5 },
        stepIndex: 5,
      };

      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 4 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId,
        reason: 'error',
        stepIndex: 5,
        uiMessages: undefined,
      });
    });

    it('should fallback to stepResult.stepIndex when terminal step result state is missing stepCount', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: { error: { message: 'boom' }, status: 'error' },
        stepIndex: 5,
      };

      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 4 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId,
        reason: 'error',
        stepIndex: stepResult.stepIndex,
        uiMessages: undefined,
      });
    });

    it('should publish end event when status becomes waiting_for_human (paused awaiting approval)', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: { status: 'waiting_for_human', stepCount: 4 },
        stepIndex: 4,
      };

      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 3 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId,
        reason: 'waiting_for_human',
        stepIndex: 4,
        uiMessages: undefined,
      });
    });

    it('should publish end event when status becomes interrupted', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: { status: 'interrupted', stepCount: 5 },
        stepIndex: 5,
      };

      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 4 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId,
        reason: 'interrupted',
        stepIndex: 5,
        uiMessages: undefined,
      });
    });

    it('should not publish end event when status is not done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 500,
        newState: { status: 'running', stepCount: 3 },
        stepIndex: 3,
      };

      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 2 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStateManager.saveStepResult).toHaveBeenCalledWith(operationId, stepResult);
      expect(mockStreamManager.publishAgentRuntimeEnd).not.toHaveBeenCalled();
    });

    it('should not publish end event when status was already done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: { status: 'error', stepCount: 5 },
        stepIndex: 5,
      };

      // Mock previous state as already done
      mockStateManager.loadAgentState.mockResolvedValue({ status: 'done', stepCount: 5 });

      await coordinator.saveStepResult(operationId, stepResult as any);

      expect(mockStateManager.saveStepResult).toHaveBeenCalledWith(operationId, stepResult);
      // Should not publish again since status was already done
      expect(mockStreamManager.publishAgentRuntimeEnd).not.toHaveBeenCalled();
    });
  });

  describe('deleteAgentOperation', () => {
    it('should delete operation from both state manager and stream manager', async () => {
      const operationId = 'test-operation-id';

      await coordinator.deleteAgentOperation(operationId);

      expect(mockStateManager.deleteAgentOperation).toHaveBeenCalledWith(operationId);
      expect(mockStreamManager.cleanupOperation).toHaveBeenCalledWith(operationId);
    });
  });

  describe('disconnect', () => {
    it('should disconnect both managers', async () => {
      await coordinator.disconnect();

      expect(mockStateManager.disconnect).toHaveBeenCalled();
      expect(mockStreamManager.disconnect).toHaveBeenCalled();
    });
  });

  describe('delegation methods', () => {
    it('should delegate loadAgentState to state manager', async () => {
      const operationId = 'test-operation-id';
      const expectedState = { status: 'running' };

      mockStateManager.loadAgentState.mockResolvedValue(expectedState);

      const result = await coordinator.loadAgentState(operationId);

      expect(mockStateManager.loadAgentState).toHaveBeenCalledWith(operationId);
      expect(result).toBe(expectedState);
    });

    it('should delegate getOperationMetadata to state manager', async () => {
      const operationId = 'test-operation-id';
      const expectedMetadata = { status: 'idle' };

      mockStateManager.getOperationMetadata.mockResolvedValue(expectedMetadata);

      const result = await coordinator.getOperationMetadata(operationId);

      expect(mockStateManager.getOperationMetadata).toHaveBeenCalledWith(operationId);
      expect(result).toBe(expectedMetadata);
    });

    it('should delegate getExecutionHistory to state manager', async () => {
      const operationId = 'test-operation-id';
      const limit = 10;
      const expectedHistory = [{ step: 1 }];

      mockStateManager.getExecutionHistory.mockResolvedValue(expectedHistory);

      const result = await coordinator.getExecutionHistory(operationId, limit);

      expect(mockStateManager.getExecutionHistory).toHaveBeenCalledWith(operationId, limit);
      expect(result).toBe(expectedHistory);
    });
  });

  // Terminal events should carry the canonical UIChatMessage[] snapshot
  // when a resolver is wired so the client can use the pushed payload as
  // Source of Truth instead of refetching from DB.
  describe('uiMessagesResolver on agent_runtime_end', () => {
    it('passes resolver result through saveAgentState terminal publish', async () => {
      const uiMessages = [{ id: 'msg_1', role: 'user' }] as any[];
      const resolver = vi.fn().mockResolvedValue(uiMessages);
      const coordinatorWithResolver = new AgentRuntimeCoordinator({
        stateManager: mockStateManager,
        streamEventManager: mockStreamManager,
        uiMessagesResolver: resolver,
      });

      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'done', stepCount: 5 };
      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinatorWithResolver.saveAgentState('op-1', newState as any);

      expect(resolver).toHaveBeenCalledWith(newState);
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId: 'op-1',
        reason: 'done',
        stepIndex: 5,
        uiMessages,
      });
    });

    it('passes resolver result through saveStepResult terminal publish', async () => {
      const uiMessages = [{ id: 'msg_a', role: 'assistantGroup' }] as any[];
      const resolver = vi.fn().mockResolvedValue(uiMessages);
      const coordinatorWithResolver = new AgentRuntimeCoordinator({
        stateManager: mockStateManager,
        streamEventManager: mockStreamManager,
        uiMessagesResolver: resolver,
      });

      const stepResult = {
        executionTime: 100,
        newState: { status: 'done', stepCount: 4 },
        stepIndex: 4,
      };
      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 3 });

      await coordinatorWithResolver.saveStepResult('op-2', stepResult as any);

      expect(resolver).toHaveBeenCalledWith(stepResult.newState);
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId: 'op-2',
        reason: 'done',
        stepIndex: 4,
        uiMessages,
      });
    });

    it('publishes with uiMessages=undefined when resolver rejects (must never fail the surrounding save)', async () => {
      const resolver = vi.fn().mockRejectedValue(new Error('db down'));
      const coordinatorWithResolver = new AgentRuntimeCoordinator({
        stateManager: mockStateManager,
        streamEventManager: mockStreamManager,
        uiMessagesResolver: resolver,
      });

      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'error', stepCount: 5 };
      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinatorWithResolver.saveAgentState('op-3', newState as any);

      expect(resolver).toHaveBeenCalled();
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId: 'op-3',
        reason: 'error',
        stepIndex: 5,
        uiMessages: undefined,
      });
    });

    it('publishes with uiMessages=undefined when no resolver is wired (default constructor)', async () => {
      // The default `coordinator` from the outer beforeEach is constructed
      // without a resolver — proves the field is genuinely optional and
      // legacy call sites stay unaffected.
      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'done', stepCount: 5 };
      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinator.saveAgentState('op-4', newState as any);

      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId: 'op-4',
        reason: 'done',
        stepIndex: 5,
        uiMessages: undefined,
      });
    });

    // LOBE-9523: cancel/interrupt path leaves the streaming assistant row
    // at the LOADING_FLAT placeholder until the executor's partial-finalize
    // catch writes the accumulated content asynchronously. Publishing a
    // pre-finalize snapshot would clobber the client's in-memory streamed
    // content, so the resolver is skipped entirely for status='interrupted'.
    it('skips uiMessages on saveAgentState when status=interrupted (LOBE-9523)', async () => {
      const resolver = vi.fn().mockResolvedValue([{ id: 'placeholder', role: 'assistant' }]);
      const coordinatorWithResolver = new AgentRuntimeCoordinator({
        stateManager: mockStateManager,
        streamEventManager: mockStreamManager,
        uiMessagesResolver: resolver,
      });

      const previousState = { status: 'running', stepCount: 3 };
      const newState = { status: 'interrupted', stepCount: 3 };
      mockStateManager.loadAgentState.mockResolvedValue(previousState);

      await coordinatorWithResolver.saveAgentState('op-int-1', newState as any);

      // Resolver should NOT be called — the whole point is to avoid the DB
      // read that would return the LOADING_FLAT placeholder.
      expect(resolver).not.toHaveBeenCalled();
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: newState,
        operationId: 'op-int-1',
        reason: 'interrupted',
        stepIndex: 3,
        uiMessages: undefined,
      });
    });

    it('skips uiMessages on saveStepResult when stepResult.newState.status=interrupted (LOBE-9523)', async () => {
      const resolver = vi.fn().mockResolvedValue([{ id: 'placeholder', role: 'assistant' }]);
      const coordinatorWithResolver = new AgentRuntimeCoordinator({
        stateManager: mockStateManager,
        streamEventManager: mockStreamManager,
        uiMessagesResolver: resolver,
      });

      const stepResult = {
        executionTime: 100,
        newState: { status: 'interrupted', stepCount: 2 },
        stepIndex: 2,
      };
      mockStateManager.loadAgentState.mockResolvedValue({ status: 'running', stepCount: 1 });

      await coordinatorWithResolver.saveStepResult('op-int-2', stepResult as any);

      expect(resolver).not.toHaveBeenCalled();
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith({
        finalState: stepResult.newState,
        operationId: 'op-int-2',
        reason: 'interrupted',
        stepIndex: 2,
        uiMessages: undefined,
      });
    });
  });
});
