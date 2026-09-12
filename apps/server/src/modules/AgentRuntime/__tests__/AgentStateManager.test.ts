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
    exists: vi.fn(),
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

    it('strips messages from the persisted state and never persists step events', async () => {
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

      // Events reach clients via the live stream and land in the operation
      // trace; the Redis list they used to fill had no readers.
      const lpushKeys = pipelineMock.lpush.mock.calls.map((c) => c[0] as string);
      expect(lpushKeys).toEqual(['agent_runtime_steps:op-strip-step']);
    });
  });

  describe('step execution lock', () => {
    it('claims an operation-scoped lock with the provided owner token', async () => {
      redisMock.eval.mockResolvedValue(1);

      await expect(stateManager.tryClaimStep('op-lock', 3, 120, 'owner-1')).resolves.toBe(true);

      const [script, keyCount, key, owner, ttl] = redisMock.eval.mock.calls[0];
      expect(script).toContain("'NX'");
      expect(keyCount).toBe(1);
      expect(key).toBe('agent_runtime_operation_lock:op-lock');
      expect(owner).toBe('owner-1');
      expect(ttl).toBe('120');
    });

    it('re-enters a lock the same owner already holds', async () => {
      // The inline step loop runs several steps under one lock. Re-entry keeps
      // the lock unbroken across step boundaries; owner tokens carry a random
      // UUID, so only the invocation that took the lock can present its token.
      redisMock.eval.mockResolvedValue(1);

      await expect(stateManager.tryClaimStep('op-lock', 4, 120, 'owner-1')).resolves.toBe(true);

      const script = redisMock.eval.mock.calls[0][0] as string;
      expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('expire', KEYS[1], ARGV[2])");
    });

    it('refuses a lock held by a different owner', async () => {
      redisMock.eval.mockResolvedValue(0);

      await expect(stateManager.tryClaimStep('op-lock', 5, 120, 'owner-2')).resolves.toBe(false);
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

  describe('interrupt sentinel', () => {
    it('markInterrupted writes a small sentinel key with the state TTL', async () => {
      await stateManager.markInterrupted('op-int');

      expect(redisMock.setex).toHaveBeenCalledWith('agent_runtime_interrupt:op-int', 2 * 3600, '1');
    });

    it('isInterrupted checks key existence instead of loading the state blob', async () => {
      redisMock.exists.mockResolvedValueOnce(1);
      expect(await stateManager.isInterrupted('op-int')).toBe(true);

      redisMock.exists.mockResolvedValueOnce(0);
      expect(await stateManager.isInterrupted('op-int')).toBe(false);

      expect(redisMock.exists).toHaveBeenCalledWith('agent_runtime_interrupt:op-int');
      expect(redisMock.get).not.toHaveBeenCalled();
    });

    it('deleteAgentOperation removes the sentinel with the other keys', async () => {
      await stateManager.deleteAgentOperation('op-del');

      expect(redisMock.del).toHaveBeenCalledWith(
        'agent_runtime_state:op-del',
        'agent_runtime_steps:op-del',
        'agent_runtime_meta:op-del',
        'agent_runtime_interrupt:op-del',
        'agent_runtime_inline_resume:op-del',
      );
    });
  });

  describe('inline resume envelope', () => {
    it('parks the envelope under the operation TTL', async () => {
      await expect(stateManager.saveInlineResume('op-resume', '{"stepIndex":4}')).resolves.toBe(
        true,
      );

      expect(redisMock.setex).toHaveBeenCalledWith(
        'agent_runtime_inline_resume:op-resume',
        2 * 3600,
        '{"stepIndex":4}',
      );
    });

    it('reads the envelope', async () => {
      redisMock.get.mockResolvedValue('{"stepIndex":4}');
      await expect(stateManager.loadInlineResume('op-resume')).resolves.toBe('{"stepIndex":4}');
    });

    it('clears the envelope only for the current lock owner', async () => {
      // An unconditional DEL lets a worker that lost the lock race delete the
      // newer envelope a live worker just parked, stranding it if it then dies.
      redisMock.eval.mockResolvedValue(1);

      await stateManager.clearInlineResume('op-resume', 'owner-1');

      const [script, keyCount, lockKey, resumeKey, owner] = redisMock.eval.mock.calls[0];
      expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('del', KEYS[2])");
      expect(keyCount).toBe(2);
      expect(lockKey).toBe('agent_runtime_operation_lock:op-resume');
      expect(resumeKey).toBe('agent_runtime_inline_resume:op-resume');
      expect(owner).toBe('owner-1');
    });

    it('reports a failed park so the caller can fall back to the queue', async () => {
      // Silently swallowing this would inline the next step with no envelope and
      // no queue message behind it — the exact stranding the envelope prevents.
      redisMock.setex.mockRejectedValueOnce(new Error('redis down'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});

      await expect(stateManager.saveInlineResume('op-resume', '{"stepIndex":4}')).resolves.toBe(
        false,
      );
      errorSpy.mockRestore();
    });

    it('surfaces a read failure instead of reporting no envelope', async () => {
      // "No envelope" means run the delivered step; "could not read the
      // envelope" may mean an operation is mid-loop with nothing queued behind
      // it. Collapsing the two would ACK that delivery as stale and strand it.
      redisMock.get.mockRejectedValue(new Error('redis down'));

      await expect(stateManager.loadInlineResume('op-resume')).rejects.toThrow('redis down');
    });
  });
});
