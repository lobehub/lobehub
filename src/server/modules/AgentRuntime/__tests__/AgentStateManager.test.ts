import { describe, expect, it, vi } from 'vitest';

import { AgentStateManager } from '../AgentStateManager';

// Mock Redis client
vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: () => ({
    del: vi.fn(),
    expire: vi.fn(),
    get: vi.fn(),
    hgetall: vi.fn(),
    hmset: vi.fn(),
    keys: vi.fn(),
    multi: vi.fn(() => ({
      exec: vi.fn(),
      expire: vi.fn(),
      hmset: vi.fn(),
      lpush: vi.fn(),
      ltrim: vi.fn(),
      setex: vi.fn(),
    })),
    quit: vi.fn(),
    setex: vi.fn(),
  }),
}));

describe('AgentStateManager', () => {
  let stateManager: AgentStateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    stateManager = new AgentStateManager();
  });

  describe('createOperationMetadata', () => {
    it('should create operation metadata successfully', async () => {
      const operationId = 'test-operation-id';
      const data = {
        agentConfig: { test: true },
        modelRuntimeConfig: { model: 'gpt-4' },
        userId: 'user-123',
      };

      await expect(stateManager.createOperationMetadata(operationId, data)).resolves.not.toThrow();
    });
  });

  describe('saveAgentState', () => {
    it('should save agent state successfully', async () => {
      const operationId = 'test-operation-id';
      const state = {
        cost: { total: 100 },
        status: 'done' as const,
        stepCount: 5,
      };

      await expect(stateManager.saveAgentState(operationId, state as any)).resolves.not.toThrow();
    });

    it('should save agent state with running status', async () => {
      const operationId = 'test-operation-id';
      const state = {
        cost: { total: 50 },
        status: 'running' as const,
        stepCount: 3,
      };

      await expect(stateManager.saveAgentState(operationId, state as any)).resolves.not.toThrow();
    });
  });

  describe('saveStepResult', () => {
    it('should save step result successfully when status is done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: {
          cost: { total: 200 },
          status: 'done' as const,
          stepCount: 10,
        },
        stepIndex: 10,
      };

      await expect(
        stateManager.saveStepResult(operationId, stepResult as any),
      ).resolves.not.toThrow();
    });

    it('should save step result successfully when status is not done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 500,
        newState: {
          cost: { total: 75 },
          status: 'running' as const,
          stepCount: 3,
        },
        stepIndex: 3,
      };

      await expect(
        stateManager.saveStepResult(operationId, stepResult as any),
      ).resolves.not.toThrow();
    });
  });
});
