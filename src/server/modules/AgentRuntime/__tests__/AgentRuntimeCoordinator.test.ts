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
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith(
        operationId,
        newState.stepCount,
        newState,
      );
    });

    it('should not publish end event when status was already done', async () => {
      const operationId = 'test-operation-id';
      const previousState = { status: 'done', stepCount: 5 };
      const newState = { status: 'done', stepCount: 5 };

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
      expect(mockStreamManager.publishAgentRuntimeEnd).toHaveBeenCalledWith(
        operationId,
        5,
        stepResult.newState,
      );
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
        newState: { status: 'done', stepCount: 5 },
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
});
