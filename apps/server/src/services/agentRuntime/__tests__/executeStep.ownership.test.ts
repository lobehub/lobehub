// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { StepOwnershipLostError } from '../AgentRuntimeService/executionErrors';

// Mock all heavy dependencies to isolate executeStep logic
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return { query: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return {
      loadAgentState: vi.fn(),
      saveAgentState: vi.fn(),
      saveStepResult: vi.fn(),
      createAgentOperation: vi.fn(),
      getOperationMetadata: vi.fn(),
      isInterrupted: vi.fn().mockResolvedValue(false),
      hasQueuedMessages: vi.fn().mockResolvedValue(false),
      tryClaimStep: vi.fn().mockResolvedValue(true),
      releaseStepLock: vi.fn().mockResolvedValue(undefined),
      refreshStepLock: vi.fn().mockResolvedValue(true),
    };
  }),
  createStreamEventManager: vi.fn(function () {
    return {
      publishStreamEvent: vi.fn(),
      publishAgentRuntimeEnd: vi.fn(),
      publishAgentRuntimeInit: vi.fn(),
      cleanupOperation: vi.fn(),
    };
  }),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(function () {
    return {
      getImpl: vi.fn(function () {
        return {};
      }),
      scheduleMessage: vi.fn(),
    };
  }),
}));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class {
    setExecutionCallback() {}
  },
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

describe('AgentRuntimeService.executeStep - step ownership', () => {
  // A step whose LLM call outlives the lock TTL can be claimed by a redelivery
  // while it still runs. Whichever attempt no longer owns the lock must not
  // commit, or two chains continue the same operation.
  const runContinuingStep = async (
    lockStillOwned: () => Promise<boolean>,
    queue: 'local' | 'none' | 'redelivering' = 'redelivering',
  ) => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-next');
    const impl = queue === 'local' ? new LocalQueueServiceImpl() : {};
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: queue === 'none' ? null : ({ getImpl: () => impl, scheduleMessage } as any),
    });
    const coordinator = (service as any).coordinator;
    const completionLifecycle = (service as any).completionLifecycle;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      lastModified: new Date().toISOString(),
      messages: [],
      metadata: {},
      status: 'running',
      stepCount: 3,
    });
    coordinator.refreshStepLock = vi.fn(lockStillOwned);
    vi.spyOn(completionLifecycle, 'emitSignalEvents').mockResolvedValue([]);
    const dispatchHooks = vi
      .spyOn(completionLifecycle, 'dispatchHooks')
      .mockResolvedValue(undefined);
    const discardPartial = vi.spyOn((service as any).traceRecorder, 'discardPartial');
    (service as any).createAgentRuntime = vi.fn().mockResolvedValue({
      runtime: {
        step: vi.fn().mockResolvedValue({
          events: [],
          newState: {
            lastModified: new Date().toISOString(),
            messages: [],
            metadata: {},
            status: 'running',
            stepCount: 4,
          },
          nextContext: { payload: {}, phase: 'llm_result' },
        }),
      },
    });

    const run = service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-owner',
      stepIndex: 3,
    });

    return { coordinator, discardPartial, dispatchHooks, run, scheduleMessage };
  };

  it('commits and queues the next step while the attempt still owns the lock', async () => {
    const { coordinator, run, scheduleMessage } = await runContinuingStep(async () => true);

    await expect(run).resolves.toMatchObject({ nextStepScheduled: true, success: true });

    expect(coordinator.saveStepResult).toHaveBeenCalledTimes(1);
    expect(coordinator.refreshStepLock).toHaveBeenCalledWith(
      'op-owner',
      3,
      120,
      expect.stringContaining('op-owner:3:'),
    );
    // Checked before the commit, not after it.
    expect(coordinator.refreshStepLock.mock.invocationCallOrder[0]).toBeLessThan(
      coordinator.saveStepResult.mock.invocationCallOrder[0],
    );
    expect(scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 4 }));
  });

  it('drops the step when another attempt took the lock during the LLM call', async () => {
    const { coordinator, discardPartial, dispatchHooks, run, scheduleMessage } =
      await runContinuingStep(async () => false);

    await expect(run).rejects.toBeInstanceOf(StepOwnershipLostError);

    expect(coordinator.saveStepResult).not.toHaveBeenCalled();
    expect(scheduleMessage).not.toHaveBeenCalled();
    // The run belongs to the new owner: no error state, no completion hooks.
    expect(coordinator.saveAgentState).not.toHaveBeenCalled();
    expect(dispatchHooks).not.toHaveBeenCalled();
    // Its trace partial would roll back the steps the new owner records.
    expect(discardPartial).toHaveBeenCalled();
  });

  it('drops the step when the lock is lost between the LLM call and the commit', async () => {
    const owned = [true, false];
    const { coordinator, run, scheduleMessage } = await runContinuingStep(
      async () => owned.shift() ?? false,
    );

    await expect(run).rejects.toBeInstanceOf(StepOwnershipLostError);

    expect(coordinator.saveStepResult).not.toHaveBeenCalled();
    expect(scheduleMessage).not.toHaveBeenCalled();
  });

  it('treats a lock that cannot be confirmed as lost', async () => {
    const { coordinator, run } = await runContinuingStep(async () => {
      throw new Error('redis down');
    });

    await expect(run).rejects.toBeInstanceOf(StepOwnershipLostError);

    expect(coordinator.saveStepResult).not.toHaveBeenCalled();
    expect(coordinator.saveAgentState).not.toHaveBeenCalled();
  });

  // Without redelivery a refused commit is never retried, and no second
  // delivery can own the step: fencing would only strand the run.
  it('keeps committing on a queue that does not redeliver a failed step', async () => {
    const { coordinator, run, scheduleMessage } = await runContinuingStep(
      async () => false,
      'local',
    );

    await expect(run).resolves.toMatchObject({ nextStepScheduled: true, success: true });

    expect(coordinator.saveStepResult).toHaveBeenCalledTimes(1);
    expect(scheduleMessage).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 4 }));
  });

  it('keeps committing when steps run without a queue', async () => {
    const { coordinator, run } = await runContinuingStep(async () => false, 'none');

    await expect(run).resolves.toMatchObject({ success: true });

    expect(coordinator.saveStepResult).toHaveBeenCalledTimes(1);
  });
});
