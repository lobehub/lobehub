// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { hookDispatcher } from '../hooks';

// Mock all heavy dependencies to isolate executeStep logic
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({
    loadAgentState: vi.fn(),
    saveAgentState: vi.fn(),
    saveStepResult: vi.fn(),
    createAgentOperation: vi.fn(),
    getOperationMetadata: vi.fn(),
    tryClaimStep: vi.fn().mockResolvedValue(true),
    releaseStepLock: vi.fn().mockResolvedValue(undefined),
  })),
  createStreamEventManager: vi.fn(() => ({
    publishStreamEvent: vi.fn(),
    publishAgentRuntimeEnd: vi.fn(),
    publishAgentRuntimeInit: vi.fn(),
    cleanupOperation: vi.fn(),
  })),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(() => ({})),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(() => ({
    getImpl: vi.fn(() => ({})),
    scheduleMessage: vi.fn(),
  })),
}));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class {},
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

describe('AgentRuntimeService.executeStep - early exit on terminal state', () => {
  const createService = () => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    return service;
  };

  const terminalStatuses = ['interrupted', 'done', 'error'] as const;

  for (const status of terminalStatuses) {
    it(`should skip step execution when operation status is "${status}"`, async () => {
      const service = createService();

      // Access private coordinator to mock loadAgentState
      const coordinator = (service as any).coordinator;
      coordinator.loadAgentState = vi.fn().mockResolvedValue({
        status,
        stepCount: 10,
        lastModified: new Date().toISOString(),
      });

      const result = await service.executeStep({
        operationId: 'op-123',
        stepIndex: 11,
        context: { phase: 'user_input' } as any,
      });

      expect(result.success).toBe(true);
      expect(result.nextStepScheduled).toBe(false);
      expect(result.state.status).toBe(status);
      expect(result.stepResult).toBeNull();
    });
  }

  it('should dispatch onComplete hook when skipping interrupted operation', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'interrupted',
      stepCount: 10,
      lastModified: new Date().toISOString(),
    });

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await service.executeStep({
      operationId: 'op-123',
      stepIndex: 11,
      context: { phase: 'user_input' } as any,
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-123',
      'onComplete',
      expect.objectContaining({
        operationId: 'op-123',
        reason: 'interrupted',
      }),
      undefined,
    );

    dispatchSpy.mockRestore();
  });

  it('should dispatch onComplete hook with reason "done" when skipping done operation', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'done',
      stepCount: 5,
      lastModified: new Date().toISOString(),
    });

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await service.executeStep({
      operationId: 'op-456',
      stepIndex: 6,
      context: { phase: 'user_input' } as any,
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-456',
      'onComplete',
      expect.objectContaining({
        operationId: 'op-456',
        reason: 'done',
      }),
      undefined,
    );

    dispatchSpy.mockRestore();
  });

  it('should unregister hooks after onComplete is dispatched on early exit', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'interrupted',
      stepCount: 10,
      lastModified: new Date().toISOString(),
    });

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);
    const unregisterSpy = vi.spyOn(hookDispatcher, 'unregister');

    await service.executeStep({
      operationId: 'op-789',
      stepIndex: 11,
      context: { phase: 'user_input' } as any,
    });

    // Hooks should be unregistered after completion dispatch
    expect(unregisterSpy).toHaveBeenCalledWith('op-789');

    dispatchSpy.mockRestore();
    unregisterSpy.mockRestore();
  });

  it('should NOT skip step when operation status is "running"', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'running',
      stepCount: 5,
      lastModified: new Date().toISOString(),
      metadata: {},
    });

    // The step will attempt to proceed (and fail due to mocked deps),
    // but the key assertion is that it does NOT take the early-exit path
    const result = await service.executeStep({
      operationId: 'op-running',
      stepIndex: 6,
      context: { phase: 'user_input' } as any,
    });

    // If early exit was taken, stepResult would be null.
    // Since it proceeded past the guard, stepResult will be a real object (with error).
    expect(result.stepResult).not.toBeNull();
  });
});

describe('AgentRuntimeService.executeStep - step idempotency (distributed lock)', () => {
  const createService = () => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    return service;
  };

  it('should return locked=true when tryClaimStep returns false', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);

    const result = await service.executeStep({
      operationId: 'op-locked',
      stepIndex: 5,
    });

    expect(result.locked).toBe(true);
    expect(result.success).toBe(false);
    expect(result.nextStepScheduled).toBe(false);
    // Should NOT call loadAgentState since lock was not acquired
    expect(coordinator.loadAgentState).not.toHaveBeenCalled();
  });

  it('should skip execution when stepCount > stepIndex (delayed retry after lock TTL)', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'running',
      stepCount: 10,
      lastModified: new Date().toISOString(),
    });

    const result = await service.executeStep({
      operationId: 'op-stale',
      stepIndex: 8,
    });

    expect(result.success).toBe(true);
    expect(result.stepResult).toBeNull();
    expect(result.nextStepScheduled).toBe(false);
    // Lock should still be released
    expect(coordinator.releaseStepLock).toHaveBeenCalledWith('op-stale', 8);
  });

  it('should release lock after successful execution', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'done',
      stepCount: 5,
      lastModified: new Date().toISOString(),
    });

    await service.executeStep({
      operationId: 'op-done',
      stepIndex: 6,
    });

    expect(coordinator.releaseStepLock).toHaveBeenCalledWith('op-done', 6);
  });

  it('should release lock even when step execution encounters an error', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'running',
      stepCount: 5,
      lastModified: new Date().toISOString(),
      metadata: {},
    });

    // executeStep will hit an error internally (mocked deps are incomplete)
    // but the catch block handles it and returns error state instead of throwing
    const result = await service.executeStep({
      operationId: 'op-error',
      stepIndex: 6,
      context: { phase: 'user_input' } as any,
    });

    expect(result.state.status).toBe('error');
    // Lock must still be released via finally block
    expect(coordinator.releaseStepLock).toHaveBeenCalledWith('op-error', 6);
  });

  it('should NOT release lock when tryClaimStep returns false', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);

    await service.executeStep({
      operationId: 'op-no-release',
      stepIndex: 3,
    });

    expect(coordinator.releaseStepLock).not.toHaveBeenCalled();
  });

  it('should call tryClaimStep with correct arguments', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);

    await service.executeStep({
      operationId: 'op-args',
      stepIndex: 42,
    });

    expect(coordinator.tryClaimStep).toHaveBeenCalledWith('op-args', 42, 35);
  });
});

describe('AgentRuntimeService.executeStep - Redis failure in error handler', () => {
  const createService = () => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    return service;
  };

  it('should still dispatch onComplete hooks when Redis fails in catch block (ECONNRESET scenario)', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);

    // First loadAgentState call succeeds (returns running state to enter step execution)
    // Second call in catch block fails (Redis ECONNRESET)
    let loadCallCount = 0;
    coordinator.loadAgentState = vi.fn().mockImplementation(() => {
      loadCallCount++;
      if (loadCallCount === 1) {
        return Promise.resolve({
          status: 'running',
          stepCount: 5,
          lastModified: new Date().toISOString(),
          metadata: {},
        });
      }
      return Promise.reject(new Error('Reached the max retries per request limit (which is 3)'));
    });

    // publishStreamEvent: first call (step_start) succeeds, subsequent calls fail
    // Simulates Redis going down mid-execution
    let publishCallCount = 0;
    streamManager.publishStreamEvent = vi.fn().mockImplementation(() => {
      publishCallCount++;
      if (publishCallCount === 1) return Promise.resolve();
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    // saveAgentState fails (Redis is down)
    coordinator.saveAgentState = vi.fn().mockRejectedValue(new Error('Redis ECONNRESET'));

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    // executeStep re-throws the original error after running hooks
    await expect(
      service.executeStep({
        operationId: 'op-redis-fail',
        stepIndex: 6,
        context: { phase: 'user_input' } as any,
      }),
    ).rejects.toThrow();

    // onComplete hooks MUST be dispatched even when Redis is completely down
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-redis-fail',
      'onComplete',
      expect.objectContaining({
        operationId: 'op-redis-fail',
        reason: 'error',
      }),
      undefined,
    );

    dispatchSpy.mockRestore();
  });

  it('should still dispatch onError hooks when Redis fails in catch block', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);

    let loadCallCount = 0;
    coordinator.loadAgentState = vi.fn().mockImplementation(() => {
      loadCallCount++;
      if (loadCallCount === 1) {
        return Promise.resolve({
          status: 'running',
          stepCount: 5,
          lastModified: new Date().toISOString(),
          metadata: {},
        });
      }
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    // First publishStreamEvent call (step_start) succeeds, subsequent fail
    let publishCallCount = 0;
    streamManager.publishStreamEvent = vi.fn().mockImplementation(() => {
      publishCallCount++;
      if (publishCallCount === 1) return Promise.resolve();
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    coordinator.saveAgentState = vi.fn().mockRejectedValue(new Error('Redis ECONNRESET'));

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    // executeStep re-throws the original error after running hooks
    await expect(
      service.executeStep({
        operationId: 'op-redis-webhook',
        stepIndex: 6,
        context: { phase: 'user_input' } as any,
      }),
    ).rejects.toThrow();

    // Both onComplete and onError hooks MUST be dispatched when reason is error
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-redis-webhook',
      'onError',
      expect.objectContaining({
        operationId: 'op-redis-webhook',
        reason: 'error',
      }),
      undefined,
    );

    dispatchSpy.mockRestore();
  });

  it('should include stepCount in fallback error state when state reload fails', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);

    let loadCallCount = 0;
    coordinator.loadAgentState = vi.fn().mockImplementation(() => {
      loadCallCount++;
      if (loadCallCount === 1) {
        return Promise.resolve({
          status: 'running',
          stepCount: 5,
          lastModified: new Date().toISOString(),
          metadata: {},
        });
      }
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    let publishCallCount = 0;
    streamManager.publishStreamEvent = vi.fn().mockImplementation(() => {
      publishCallCount++;
      if (publishCallCount === 1) return Promise.resolve();
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        operationId: 'op-fallback-step-count',
        stepIndex: 6,
        context: { phase: 'user_input' } as any,
      }),
    ).rejects.toThrow();

    expect(coordinator.saveAgentState).toHaveBeenCalledWith(
      'op-fallback-step-count',
      expect.objectContaining({
        status: 'error',
        stepCount: 6,
      }),
    );
  });

  it('should preserve stepCount when loadAgentState returns null in error handler', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);

    let loadCallCount = 0;
    coordinator.loadAgentState = vi.fn().mockImplementation(() => {
      loadCallCount++;
      if (loadCallCount === 1) {
        return Promise.resolve({
          status: 'running',
          stepCount: 5,
          lastModified: new Date().toISOString(),
          metadata: {},
        });
      }
      return Promise.resolve(null);
    });

    let publishCallCount = 0;
    streamManager.publishStreamEvent = vi.fn().mockImplementation(() => {
      publishCallCount++;
      if (publishCallCount === 1) return Promise.resolve();
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        operationId: 'op-null-step-count',
        stepIndex: 7,
        context: { phase: 'user_input' } as any,
      }),
    ).rejects.toThrow();

    expect(coordinator.saveAgentState).toHaveBeenCalledWith(
      'op-null-step-count',
      expect.objectContaining({
        status: 'error',
        stepCount: 7,
      }),
    );
  });

  it('should preserve loaded state metadata when only saveAgentState fails', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);

    const stateWithHooks = {
      status: 'running',
      stepCount: 5,
      lastModified: new Date().toISOString(),
      metadata: {
        _hooks: [
          {
            id: 'test-hook',
            type: 'onComplete',
            webhook: { url: 'https://example.com/webhook' },
          },
        ],
      },
    };

    // loadAgentState always succeeds (returns state with hook metadata)
    coordinator.loadAgentState = vi.fn().mockResolvedValue(stateWithHooks);

    // saveAgentState fails (write-only Redis failure)
    coordinator.saveAgentState = vi.fn().mockRejectedValue(new Error('Redis write failed'));

    // publishStreamEvent: first call succeeds, subsequent fail
    let publishCallCount = 0;
    streamManager.publishStreamEvent = vi.fn().mockImplementation(() => {
      publishCallCount++;
      if (publishCallCount === 1) return Promise.resolve();
      return Promise.reject(new Error('Redis ECONNRESET'));
    });

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        operationId: 'op-save-fail',
        stepIndex: 6,
        context: { phase: 'user_input' } as any,
      }),
    ).rejects.toThrow();

    // onComplete hooks must be dispatched with the full state including metadata
    expect(dispatchSpy).toHaveBeenCalledWith(
      'op-save-fail',
      'onComplete',
      expect.objectContaining({
        operationId: 'op-save-fail',
        reason: 'error',
        finalState: expect.objectContaining({
          metadata: expect.objectContaining({
            _hooks: expect.arrayContaining([
              expect.objectContaining({
                id: 'test-hook',
                webhook: { url: 'https://example.com/webhook' },
              }),
            ]),
          }),
          status: 'error',
        }),
      }),
      expect.anything(),
    );

    dispatchSpy.mockRestore();
  });
});

describe('AgentRuntimeService.executeStep - error-path snapshot finalize (LOBE-8533)', () => {
  it('finalizes a snapshot with completionReason=error and a synthetic failed step when the executor throws', async () => {
    const snapshotStore = {
      get: vi.fn(),
      getLatest: vi.fn(),
      list: vi.fn(),
      listPartials: vi.fn(),
      // A partial WITH steps already recorded — simulates a tool dispatch
      // that succeeded for several prior steps before persist-fatal hit.
      loadPartial: vi.fn().mockResolvedValue({
        startedAt: 1_777_960_000_000,
        steps: [
          {
            stepIndex: 0,
            stepType: 'call_llm',
            startedAt: 1_777_960_000_000,
            completedAt: 1_777_960_001_000,
            executionTimeMs: 1000,
            totalCost: 0,
            totalTokens: 100,
          },
        ],
      }),
      removePartial: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      savePartial: vi.fn().mockResolvedValue(undefined),
    };

    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      snapshotStore: snapshotStore as any,
    });
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.releaseStepLock = vi.fn().mockResolvedValue(undefined);
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);

    // First load returns a running state to enter step execution; second
    // load (in the catch) returns the same so finalStateWithError carries
    // metadata.
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      lastModified: new Date().toISOString(),
      metadata: { agentId: 'agt-1', topicId: 'tpc-1', userId: 'user-1' },
      status: 'running',
      stepCount: 1,
    });
    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    // Force the runtime.step path to throw — simulates markPersistFatal
    // bubbling up from RuntimeExecutors.
    const persistFatal = new Error('parent message missing');
    (persistFatal as any).errorType = 'ConversationParentMissing';
    vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({
      runtime: { step: vi.fn().mockRejectedValue(persistFatal) },
    });

    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        context: { phase: 'tool_use' } as any,
        operationId: 'op-fatal-1',
        stepIndex: 1,
      }),
    ).rejects.toThrow();

    // The op MUST land in the canonical S3 path with completionReason=error
    expect(snapshotStore.save).toHaveBeenCalledTimes(1);
    const saved = snapshotStore.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      agentId: 'agt-1',
      completionReason: 'error',
      operationId: 'op-fatal-1',
      topicId: 'tpc-1',
      userId: 'user-1',
    });
    expect(saved.error).toMatchObject({ type: 'ConversationParentMissing' });

    // The failing step must be appended so the snapshot's step count tracks
    // the assistant message that triggered the failed call (otherwise the
    // partial would lag by one and the dangling tool_use would still look
    // unattributed).
    const failedStep = saved.steps.find((s: any) => s.stepIndex === 1);
    expect(failedStep).toBeDefined();
    expect(failedStep.events?.[0]).toMatchObject({ type: 'error' });

    expect(snapshotStore.removePartial).toHaveBeenCalledWith('op-fatal-1');

    dispatchSpy.mockRestore();
  });

  it('skips finalize when there is no partial (op never recorded a step)', async () => {
    const snapshotStore = {
      get: vi.fn(),
      getLatest: vi.fn(),
      list: vi.fn(),
      listPartials: vi.fn(),
      loadPartial: vi.fn().mockResolvedValue(null),
      removePartial: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      savePartial: vi.fn().mockResolvedValue(undefined),
    };

    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      snapshotStore: snapshotStore as any,
    });
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.releaseStepLock = vi.fn().mockResolvedValue(undefined);
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      lastModified: new Date().toISOString(),
      metadata: {},
      status: 'running',
      stepCount: 0,
    });
    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({
      runtime: { step: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        context: { phase: 'user_input' } as any,
        operationId: 'op-no-partial',
        stepIndex: 0,
      }),
    ).rejects.toThrow();

    // No partial -> nothing to finalize. Don't write an empty snapshot.
    expect(snapshotStore.save).not.toHaveBeenCalled();
    expect(snapshotStore.removePartial).not.toHaveBeenCalled();

    dispatchSpy.mockRestore();
  });

  it('reports totalSteps from the finalized step array, not stepCount, on the error path', async () => {
    // Partial has step 0 from a prior successful step. The catch path will
    // synthesize step 1 for the failure. After finalize, partial.steps.length
    // is 2 — but Redis-loaded stepCount is still 1 (last completed step
    // before failure). The snapshot must report 2.
    const snapshotStore = {
      get: vi.fn(),
      getLatest: vi.fn(),
      list: vi.fn(),
      listPartials: vi.fn(),
      loadPartial: vi.fn().mockResolvedValue({
        startedAt: 1_777_960_000_000,
        steps: [
          {
            stepIndex: 0,
            stepType: 'call_llm',
            startedAt: 1_777_960_000_000,
            completedAt: 1_777_960_001_000,
            executionTimeMs: 1000,
            totalCost: 0,
            totalTokens: 100,
          },
        ],
      }),
      removePartial: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      savePartial: vi.fn().mockResolvedValue(undefined),
    };

    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      snapshotStore: snapshotStore as any,
    });
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.releaseStepLock = vi.fn().mockResolvedValue(undefined);
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      lastModified: new Date().toISOString(),
      metadata: { agentId: 'agt-1', topicId: 'tpc-1', userId: 'user-1' },
      status: 'running',
      stepCount: 1,
    });
    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({
      runtime: { step: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        context: { phase: 'tool_use' } as any,
        operationId: 'op-totalsteps',
        stepIndex: 1,
      }),
    ).rejects.toThrow();

    expect(snapshotStore.save).toHaveBeenCalledTimes(1);
    const saved = snapshotStore.save.mock.calls[0][0];
    expect(saved.steps).toHaveLength(2);
    expect(saved.totalSteps).toBe(2);

    dispatchSpy.mockRestore();
  });

  it('does not duplicate a step when the failing index was already appended to the partial', async () => {
    // Simulates: success-path append wrote stepIndex=1 to the partial during
    // a prior attempt, then a later failure (e.g. queue scheduling threw)
    // sent the operation into a retry whose catch path synthesizes the same
    // stepIndex. The error event must be merged into the existing record
    // instead of pushing a duplicate that corrupts ordering and metrics.
    const snapshotStore = {
      get: vi.fn(),
      getLatest: vi.fn(),
      list: vi.fn(),
      listPartials: vi.fn(),
      loadPartial: vi.fn().mockResolvedValue({
        startedAt: 1_777_960_000_000,
        steps: [
          {
            stepIndex: 0,
            stepType: 'call_llm',
            startedAt: 1_777_960_000_000,
            completedAt: 1_777_960_001_000,
            executionTimeMs: 1000,
            totalCost: 0,
            totalTokens: 100,
          },
          {
            stepIndex: 1,
            stepType: 'call_tool',
            startedAt: 1_777_960_002_000,
            completedAt: 1_777_960_003_000,
            events: [{ type: 'done' }],
            executionTimeMs: 1000,
            totalCost: 0,
            totalTokens: 50,
          },
        ],
      }),
      removePartial: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      savePartial: vi.fn().mockResolvedValue(undefined),
    };

    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      snapshotStore: snapshotStore as any,
    });
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.releaseStepLock = vi.fn().mockResolvedValue(undefined);
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);
    // stepCount=1 so the layer-2 early-exit guard (stepCount > stepIndex) does
    // not skip this attempt — we want the catch path to run.
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      lastModified: new Date().toISOString(),
      metadata: { agentId: 'agt-1', topicId: 'tpc-1', userId: 'user-1' },
      status: 'running',
      stepCount: 1,
    });
    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({
      runtime: { step: vi.fn().mockRejectedValue(new Error('queue down')) },
    });
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

    await expect(
      service.executeStep({
        context: { phase: 'tool_use' } as any,
        operationId: 'op-dedup',
        stepIndex: 1,
      }),
    ).rejects.toThrow();

    expect(snapshotStore.save).toHaveBeenCalledTimes(1);
    const saved = snapshotStore.save.mock.calls[0][0];

    // Exactly one step per index — no duplicates from the synthetic append.
    expect(saved.steps).toHaveLength(2);
    expect(saved.steps.map((s: any) => s.stepIndex)).toEqual([0, 1]);

    // The original stepIndex=1 record is preserved, with the error event
    // appended after the existing 'done' event.
    const merged = saved.steps.find((s: any) => s.stepIndex === 1);
    expect(merged.events).toHaveLength(2);
    expect(merged.events[0]).toMatchObject({ type: 'done' });
    expect(merged.events[1]).toMatchObject({ type: 'error' });

    dispatchSpy.mockRestore();
  });
});
