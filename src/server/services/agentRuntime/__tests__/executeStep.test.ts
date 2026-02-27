// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '../AgentRuntimeService';

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
vi.mock('@/server/services/pluginGateway', () => ({
  PluginGatewayService: vi.fn().mockImplementation(() => ({})),
}));
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
vi.mock('@/tools/dynamicInterventionAudits', () => ({
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

  it('should call onComplete callback when skipping interrupted operation', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'interrupted',
      stepCount: 10,
      lastModified: new Date().toISOString(),
    });

    const onComplete = vi.fn();
    service.registerStepCallbacks('op-123', { onComplete });

    await service.executeStep({
      operationId: 'op-123',
      stepIndex: 11,
      context: { phase: 'user_input' } as any,
    });

    expect(onComplete).toHaveBeenCalledWith({
      finalState: expect.objectContaining({ status: 'interrupted' }),
      operationId: 'op-123',
      reason: 'interrupted',
    });
  });

  it('should call onComplete with reason "done" when skipping done operation', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'done',
      stepCount: 5,
      lastModified: new Date().toISOString(),
    });

    const onComplete = vi.fn();
    service.registerStepCallbacks('op-456', { onComplete });

    await service.executeStep({
      operationId: 'op-456',
      stepIndex: 6,
      context: { phase: 'user_input' } as any,
    });

    expect(onComplete).toHaveBeenCalledWith({
      finalState: expect.objectContaining({ status: 'done' }),
      operationId: 'op-456',
      reason: 'done',
    });
  });

  it('should unregister callbacks after onComplete is called on early exit', async () => {
    const service = createService();

    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'interrupted',
      stepCount: 10,
      lastModified: new Date().toISOString(),
    });

    const onComplete = vi.fn();
    service.registerStepCallbacks('op-789', { onComplete });

    await service.executeStep({
      operationId: 'op-789',
      stepIndex: 11,
      context: { phase: 'user_input' } as any,
    });

    // Callbacks should be unregistered after onComplete
    expect(service.getStepCallbacks('op-789')).toBeUndefined();
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
