import { describe, expect, it, vi } from 'vitest';

import { AgentStateManager } from '../AgentStateManager';

// Mock Redis client. Hoisted so individual tests can assert on the exact
// payloads handed to `setex` / `lpush`.
const { redisMock, pipelineMock } = vi.hoisted(() => {
  const pipelineMock = {
    exec: vi.fn(),
    expire: vi.fn(),
    hmset: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    setex: vi.fn(),
  };
  const redisMock = {
    del: vi.fn(),
    eval: vi.fn(),
    expire: vi.fn(),
    get: vi.fn(),
    hgetall: vi.fn(),
    hmset: vi.fn(),
    keys: vi.fn(),
    multi: vi.fn(() => pipelineMock),
    quit: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
  };
  return { pipelineMock, redisMock };
});

vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: () => redisMock,
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

    it('omits the messages array from the persisted state blob', async () => {
      const state = {
        cost: { total: 1 },
        messages: [{ content: 'x'.repeat(1000), id: 'msg-1', role: 'user' }],
        status: 'running' as const,
        stepCount: 1,
      };

      await stateManager.saveAgentState('op-strip', state as any);

      const serialized = redisMock.setex.mock.calls.at(-1)?.[2] as string;
      expect(JSON.parse(serialized).messages).toBeUndefined();
      // Other fields are retained.
      expect(JSON.parse(serialized).status).toBe('running');
    });

    it('keeps the full messages array when an ephemeral (id-less) message is present', async () => {
      const state = {
        cost: { total: 1 },
        messages: [
          { content: 'persisted history', id: 'msg-1', role: 'user' },
          // ephemeral supervisor instruction — never written to the DB (no id)
          { content: 'respond to the group', role: 'user' },
        ],
        status: 'running' as const,
        stepCount: 1,
      };

      await stateManager.saveAgentState('op-ephemeral', state as any);

      const serialized = redisMock.setex.mock.calls.at(-1)?.[2] as string;
      const persisted = JSON.parse(serialized);
      expect(persisted.messages).toHaveLength(2);
      expect(persisted.messages[1].content).toBe('respond to the group');
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

    it('strips messages from both the persisted state and the done-event finalState', async () => {
      const stepResult = {
        events: [
          {
            finalState: {
              messages: [{ content: 'big assistant answer', role: 'assistant' }],
              status: 'done',
            },
            reason: 'completed',
            type: 'done',
          },
        ],
        executionTime: 1,
        newState: {
          cost: { total: 1 },
          messages: [{ content: 'x'.repeat(1000), id: 'msg-1', role: 'user' }],
          status: 'done' as const,
          stepCount: 1,
        },
        stepIndex: 1,
      };

      await stateManager.saveStepResult('op-strip-step', stepResult as any);

      const stateValue = pipelineMock.setex.mock.calls.at(-1)?.[2] as string;
      expect(JSON.parse(stateValue).messages).toBeUndefined();

      const eventsValue = pipelineMock.lpush.mock.calls.at(-1)?.[1] as string;
      const persistedEvents = JSON.parse(eventsValue);
      expect(persistedEvents[0].finalState.messages).toBeUndefined();
      // The event envelope itself is preserved.
      expect(persistedEvents[0].type).toBe('done');
      expect(persistedEvents[0].finalState.status).toBe('done');
    });
  });

  describe('step execution lock', () => {
    it('claims an operation-scoped lock with the provided owner token', async () => {
      redisMock.set.mockResolvedValue('OK');

      await expect(stateManager.tryClaimStep('op-lock', 3, 120, 'owner-1')).resolves.toBe(true);

      expect(redisMock.set).toHaveBeenCalledWith(
        'agent_runtime_operation_lock:op-lock',
        'owner-1',
        'EX',
        120,
        'NX',
      );
    });

    it('refreshes only the lock owned by the caller', async () => {
      redisMock.eval.mockResolvedValue(1);

      await expect(stateManager.refreshStepLock('op-lock', 4, 120, 'owner-1')).resolves.toBe(true);

      expect(redisMock.eval).toHaveBeenCalledWith(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        'agent_runtime_operation_lock:op-lock',
        'owner-1',
        '120',
      );
    });

    it('releases only the lock owned by the caller', async () => {
      redisMock.eval.mockResolvedValue(1);

      await stateManager.releaseStepLock('op-lock', 5, 'owner-1');

      expect(redisMock.eval).toHaveBeenCalledWith(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        'agent_runtime_operation_lock:op-lock',
        'owner-1',
      );
    });
  });
});
