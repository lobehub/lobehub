// @vitest-environment node
import { GeneralChatAgent, GraphAgent } from '@lobechat/agent-runtime';
import type { AgentGraph } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  type AgentInterventionContinuationProvenance,
  deriveAgentInterventionQueueDeduplicationId,
} from '@/business/server/agent-run/agentInterventionIdentity';
import { createRuntimeExecutors } from '@/server/modules/AgentRuntime/RuntimeExecutors';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { CriticalAgentInterventionPersistenceError } from '../CompletionLifecycle';
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
    refreshStepLock: vi.fn().mockResolvedValue(true),
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

describe('AgentRuntimeService intervention continuation dispatch recovery', () => {
  const operationId = 'op-intervention-recovery';
  const provenance: AgentInterventionContinuationProvenance = {
    resolutionRequestId: 'request-intervention-recovery',
    sourceOperationId: 'op-source',
    sourceToolMessageIds: ['tool-message'],
  };
  const deduplicationId = deriveAgentInterventionQueueDeduplicationId(operationId, 0);
  const preparation = {
    deduplicationId,
    resolutionRequestId: provenance.resolutionRequestId,
    state: 'ready' as const,
    stepIndex: 0,
  };
  const readyState = (status: 'done' | 'idle' | 'running' = 'idle') => ({
    initialContext: { phase: 'user_input' },
    metadata: {
      agentInterventionContinuation: provenance,
      agentInterventionPreparation: preparation,
    },
    operationId,
    status,
  });

  it.each(['idle', 'running', 'done'] as const)(
    'backfills durable preparation and a stable queue ACK from %s state',
    async (status) => {
      const scheduleMessage = vi.fn().mockResolvedValue('queue-message');
      const service = new AgentRuntimeService({} as any, 'user-1', {
        queueService: { getImpl: () => ({}), scheduleMessage } as any,
      });
      const coordinator = (service as any).coordinator;
      coordinator.loadAgentState = vi.fn().mockResolvedValue(readyState(status));
      const operationModel = (service as any).agentOperationModel;
      operationModel.findById = vi.fn().mockResolvedValue({
        metadata: { agentInterventionContinuation: provenance },
      });
      operationModel.recordAgentInterventionPreparation = vi.fn().mockResolvedValue(true);
      operationModel.recordAgentInterventionDispatch = vi.fn().mockResolvedValue(true);

      await expect(service.ensureInterventionContinuationStarted(operationId)).resolves.toBe(
        'scheduled',
      );

      expect(operationModel.recordAgentInterventionPreparation).toHaveBeenCalledWith(
        operationId,
        preparation,
      );
      expect(scheduleMessage).toHaveBeenCalledTimes(1);
      expect(scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ deduplicationId, operationId, stepIndex: 0 }),
      );
      expect(operationModel.recordAgentInterventionDispatch).toHaveBeenCalledWith(
        operationId,
        expect.objectContaining({
          deduplicationId,
          messageId: 'queue-message',
          resolutionRequestId: provenance.resolutionRequestId,
          state: 'scheduled',
        }),
      );
    },
  );

  it('does not enqueue again when the exact durable queue ACK already exists', async () => {
    const scheduleMessage = vi.fn();
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue(readyState('running'));
    const operationModel = (service as any).agentOperationModel;
    operationModel.findById = vi.fn().mockResolvedValue({
      metadata: {
        agentInterventionContinuation: provenance,
        agentInterventionDispatch: {
          deduplicationId,
          messageId: 'queue-message',
          resolutionRequestId: provenance.resolutionRequestId,
          state: 'scheduled',
        },
        agentInterventionPreparation: preparation,
      },
    });
    operationModel.recordAgentInterventionPreparation = vi.fn();

    await expect(service.ensureInterventionContinuationStarted(operationId)).resolves.toBe(
      'already_started',
    );

    expect(operationModel.recordAgentInterventionPreparation).not.toHaveBeenCalled();
    expect(scheduleMessage).not.toHaveBeenCalled();
  });

  it('fails closed on a conflicting durable preparation marker', async () => {
    const scheduleMessage = vi.fn();
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue(readyState());
    const operationModel = (service as any).agentOperationModel;
    operationModel.findById = vi.fn().mockResolvedValue({
      metadata: {
        agentInterventionContinuation: provenance,
        agentInterventionPreparation: { ...preparation, resolutionRequestId: 'foreign-request' },
      },
    });

    await expect(service.ensureInterventionContinuationStarted(operationId)).rejects.toThrow(
      /durable preparation conflict/,
    );
    expect(scheduleMessage).not.toHaveBeenCalled();
  });
});

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

  it('threads workspaceId into runtime executors for workspace-scoped agent runs', async () => {
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      workspaceId: 'ws-1',
    });

    await (service as any).createAgentRuntime({
      metadata: {
        agentConfig: {},
        modelRuntimeConfig: { model: 'gpt-test', provider: 'lobehub' },
        userId: 'user-1',
      },
      operationId: 'op-workspace',
      stepIndex: 0,
    });

    expect(createRuntimeExecutors).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('disables early final visible output end for custom multi-step agents', async () => {
    vi.mocked(createRuntimeExecutors).mockClear();
    const service = new AgentRuntimeService({} as any, 'user-1', {
      agentFactory: () => ({ runner: vi.fn() }) as any,
      queueService: null,
    });

    await (service as any).createAgentRuntime({
      metadata: {
        agentConfig: {},
        modelRuntimeConfig: { model: 'gpt-test', provider: 'lobehub' },
        userId: 'user-1',
      },
      operationId: 'op-custom-agent',
      stepIndex: 0,
    });

    expect(createRuntimeExecutors).toHaveBeenCalledWith(
      expect.objectContaining({ allowEarlyFinalAnswerVisibleOutputEnd: false }),
    );
  });

  it('disables early final visible output end for GraphAgent', async () => {
    vi.mocked(createRuntimeExecutors).mockClear();
    const graph = {
      edges: [{ from: '__root__', instruction: 'Answer the user.', to: 'answer' }],
      fields: {},
      name: 'answer-graph',
      nodes: { answer: { type: 'llm' } },
      terminal: 'answer',
    } satisfies AgentGraph;
    const service = new AgentRuntimeService({} as any, 'user-1', {
      agentFactory: (config) => new GraphAgent({ ...config, graph }),
      queueService: null,
    });

    await (service as any).createAgentRuntime({
      metadata: {
        agentConfig: {},
        modelRuntimeConfig: { model: 'gpt-test', provider: 'lobehub' },
        userId: 'user-1',
      },
      operationId: 'op-graph-agent',
      stepIndex: 0,
    });

    expect(createRuntimeExecutors).toHaveBeenCalledWith(
      expect.objectContaining({ allowEarlyFinalAnswerVisibleOutputEnd: false }),
    );
  });

  it('allows early final visible output end when a factory returns GeneralChatAgent', async () => {
    vi.mocked(createRuntimeExecutors).mockClear();
    const service = new AgentRuntimeService({} as any, 'user-1', {
      agentFactory: (config) => new GeneralChatAgent(config),
      queueService: null,
    });

    await (service as any).createAgentRuntime({
      metadata: {
        agentConfig: {},
        modelRuntimeConfig: { model: 'gpt-test', provider: 'lobehub' },
        userId: 'user-1',
      },
      operationId: 'op-general-agent',
      stepIndex: 0,
    });

    expect(createRuntimeExecutors).toHaveBeenCalledWith(
      expect.objectContaining({ allowEarlyFinalAnswerVisibleOutputEnd: true }),
    );
  });

  const sandboxToolCallState = (path: string) => ({
    messages: [
      {
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ path }),
              name: 'lobe-cloud-sandbox____writeFile____builtin',
            },
            id: 'call-1',
            type: 'function',
          },
        ],
      },
    ],
  });

  it('suppresses early visible output end once the run edited entity-format files', async () => {
    // Completion still has to export + register those files as `file` Works
    // BEFORE the terminal snapshot; an early hint would end the visible loading
    // seconds before the file-Work card can exist.
    vi.mocked(createRuntimeExecutors).mockClear();
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });

    await (service as any).createAgentRuntime({
      agentState: sandboxToolCallState('/work/deck.pptx'),
      metadata: {
        agentConfig: {},
        modelRuntimeConfig: { model: 'gpt-test', provider: 'lobehub' },
        userId: 'user-1',
      },
      operationId: 'op-entity-edit',
      stepIndex: 3,
    });

    expect(createRuntimeExecutors).toHaveBeenCalledWith(
      expect.objectContaining({ allowEarlyFinalAnswerVisibleOutputEnd: false }),
    );
  });

  it('keeps the early hint when edited files are not entity-format', async () => {
    vi.mocked(createRuntimeExecutors).mockClear();
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });

    await (service as any).createAgentRuntime({
      agentState: sandboxToolCallState('/work/notes.md'),
      metadata: {
        agentConfig: {},
        modelRuntimeConfig: { model: 'gpt-test', provider: 'lobehub' },
        userId: 'user-1',
      },
      operationId: 'op-plain-edit',
      stepIndex: 3,
    });

    expect(createRuntimeExecutors).toHaveBeenCalledWith(
      expect.objectContaining({ allowEarlyFinalAnswerVisibleOutputEnd: true }),
    );
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

describe('AgentRuntimeService.executeStep - durable Review lifecycle retry', () => {
  it('keeps the operation parked and replays only Review lifecycle on the same-step retry', async () => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;
    const completionLifecycle = (service as any).completionLifecycle;

    let storedState: any = {
      cost: { currency: 'USD', total: 0 },
      lastModified: new Date().toISOString(),
      messages: [],
      metadata: { _hooks: [] },
      operationId: 'op-review-retry',
      status: 'running',
      stepCount: 0,
      toolManifestMap: {},
      usage: {},
    };
    const parkedState = {
      ...storedState,
      pendingApprovalBatch: {
        assistantMessageId: 'assistant-1',
        id: 'op-review-retry:1:assistant-1',
        sealed: true as const,
        stepIndex: 1,
      },
      pendingToolMessageIds: { 'call-1': 'tool-1' },
      pendingToolsCalling: [{ apiName: 'run', id: 'call-1', identifier: 'shell' }],
      status: 'waiting_for_human' as const,
      stepCount: 1,
    };

    coordinator.loadAgentState = vi.fn().mockImplementation(async () => storedState);
    coordinator.saveStepResult = vi.fn().mockImplementation(async (_operationId, stepResult) => {
      storedState = stepResult.newState;
    });
    coordinator.saveAgentState = vi.fn().mockImplementation(async (_operationId, state) => {
      storedState = state;
    });
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);

    const runtimeStep = vi.fn().mockResolvedValue({
      events: [],
      newState: parkedState,
      nextContext: undefined,
    });
    vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({
      runtime: { step: runtimeStep },
    });
    vi.spyOn(completionLifecycle, 'emitSignalEvents').mockResolvedValue([]);
    vi.spyOn(completionLifecycle as any, 'persistCompletion').mockResolvedValue(true);
    const notifyPendingReview = vi
      .spyOn(completionLifecycle as any, 'notifyPendingAgentIntervention')
      .mockRejectedValueOnce(
        new CriticalAgentInterventionPersistenceError(
          'op-review-retry',
          new Error('Review store unavailable'),
        ),
      )
      .mockResolvedValueOnce(undefined);
    const hookDispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const finalizeTrace = vi.spyOn((service as any).traceRecorder, 'finalize');

    await expect(
      service.executeStep({
        context: { phase: 'agent_step' } as any,
        operationId: 'op-review-retry',
        stepIndex: 0,
      }),
    ).rejects.toBeInstanceOf(CriticalAgentInterventionPersistenceError);

    expect(storedState.status).toBe('waiting_for_human');
    expect(storedState.error).toBeUndefined();
    expect(storedState.metadata._agentInterventionLifecycle).toEqual({
      state: 'pending',
      stepIndex: 0,
    });
    expect(coordinator.saveAgentState).not.toHaveBeenCalled();
    expect(notifyPendingReview).toHaveBeenCalledTimes(1);

    const retryResult = await service.executeStep({
      context: { phase: 'agent_step' } as any,
      externalRetryCount: 1,
      operationId: 'op-review-retry',
      stepIndex: 0,
    });

    expect(retryResult).toMatchObject({
      nextStepScheduled: false,
      state: { status: 'waiting_for_human' },
      stepResult: null,
      success: true,
    });
    expect(notifyPendingReview).toHaveBeenCalledTimes(2);
    expect(runtimeStep).toHaveBeenCalledTimes(1);
    expect(coordinator.saveStepResult).toHaveBeenCalledTimes(1);
    expect(storedState.metadata._agentInterventionLifecycle).toEqual({
      state: 'completed',
      stepIndex: 0,
    });
    expect(
      streamManager.publishStreamEvent.mock.calls.filter(([, event]: any) =>
        ['step_start', 'step_complete'].includes(event.type),
      ),
    ).toHaveLength(2);
    expect(
      hookDispatch.mock.calls.filter(([, hookType]) => hookType === 'beforeStep'),
    ).toHaveLength(1);
    expect(hookDispatch.mock.calls.filter(([, hookType]) => hookType === 'afterStep')).toHaveLength(
      1,
    );
    expect(
      hookDispatch.mock.calls.filter(([, hookType]) => hookType === 'onComplete'),
    ).toHaveLength(1);
    expect(hookDispatch).toHaveBeenCalledWith(
      'op-review-retry',
      'onComplete',
      expect.objectContaining({ reason: 'waiting_for_human' }),
      [],
    );
    expect(finalizeTrace).toHaveBeenCalledTimes(1);
    expect(finalizeTrace).toHaveBeenCalledWith(
      'op-review-retry',
      expect.objectContaining({ completionReason: 'waiting_for_human' }),
    );

    // The Review + hook finished, but the provider did not observe our HTTP
    // response and redelivered once more. The durable completion checkpoint
    // makes this an ordinary stale ACK: neither side effect runs again.
    const responseLossRetry = await service.executeStep({
      context: { phase: 'agent_step' } as any,
      externalRetryCount: 2,
      operationId: 'op-review-retry',
      stepIndex: 0,
    });

    expect(responseLossRetry).toMatchObject({
      nextStepScheduled: false,
      state: { status: 'waiting_for_human' },
      stepResult: null,
      success: true,
    });
    expect(notifyPendingReview).toHaveBeenCalledTimes(2);
    expect(runtimeStep).toHaveBeenCalledTimes(1);
    expect(coordinator.saveStepResult).toHaveBeenCalledTimes(1);
    expect(
      hookDispatch.mock.calls.filter(([, hookType]) => hookType === 'onComplete'),
    ).toHaveLength(1);
  });
});

describe('AgentRuntimeService.executeStep - step idempotency (distributed lock)', () => {
  const createService = () => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    return service;
  };

  it('should return locked=true for a non-stale lock conflict', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'running',
      stepCount: 5,
      lastModified: new Date().toISOString(),
    });

    const result = await service.executeStep({
      operationId: 'op-locked',
      stepIndex: 5,
    });

    expect(result.locked).toBe(true);
    expect(result.success).toBe(false);
    expect(result.nextStepScheduled).toBe(false);
    expect(coordinator.loadAgentState).toHaveBeenCalledWith('op-locked');
    expect(coordinator.releaseStepLock).not.toHaveBeenCalled();
  });

  it('should re-queue the same step on its own backoff for a non-stale lock conflict', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'running',
      stepCount: 5,
      metadata: { queueRetries: 5, queueRetryDelay: '10000' },
    });

    const result = await service.executeStep({ operationId: 'op-requeue', stepIndex: 5 });

    expect(result.locked).toBe(true);
    expect(result.lockRescheduled).toBe(true);
    // ACK so the queue doesn't retry on top of the re-delivery we just scheduled.
    expect(result.success).toBe(true);
    expect(scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-requeue',
        payload: { lockRetryAttempt: 1 },
        retries: 5,
        retryDelay: '10000',
        stepIndex: 5,
      }),
    );
    expect(coordinator.releaseStepLock).not.toHaveBeenCalled();
  });

  it('should carry the delivery resume payload into the re-queued lock-conflict message', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({ status: 'running', stepCount: 5 });

    // A human-intervention resume that lost the lock race. Re-queueing only the
    // retry counter would run a plain step and drop the approval entirely.
    await service.executeStep({
      approvedToolCall: { id: 'call-1' },
      humanInput: 'approved',
      operationId: 'op-resume',
      rejectAndContinue: false,
      stepIndex: 5,
      toolMessageId: 'msg-tool-1',
    });

    expect(scheduleMessage.mock.calls[0][0].payload).toMatchObject({
      approvedToolCall: { id: 'call-1' },
      humanInput: 'approved',
      lockRetryAttempt: 1,
      rejectAndContinue: false,
      toolMessageId: 'msg-tool-1',
    });
  });

  it('should carry an async-tool resume flag into the re-queued lock-conflict message', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({ status: 'running', stepCount: 5 });

    await service.executeStep({
      operationId: 'op-async-resume',
      resumeAsyncTool: true,
      stepIndex: 5,
    });

    expect(scheduleMessage.mock.calls[0][0].payload).toMatchObject({
      lockRetryAttempt: 1,
      resumeAsyncTool: true,
    });
  });

  it('should back off exponentially across successive lock-conflict re-deliveries', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({ status: 'running', stepCount: 5 });

    await service.executeStep({ lockRetryAttempt: 0, operationId: 'op-b', stepIndex: 5 });
    await service.executeStep({ lockRetryAttempt: 2, operationId: 'op-b', stepIndex: 5 });

    expect(scheduleMessage.mock.calls[0][0]).toMatchObject({
      delay: 15_000,
      payload: { lockRetryAttempt: 1 },
    });
    expect(scheduleMessage.mock.calls[1][0]).toMatchObject({
      delay: 60_000,
      payload: { lockRetryAttempt: 3 },
    });
  });

  it('should fall back to a retryable response once the lock-conflict backoff is exhausted', async () => {
    const scheduleMessage = vi.fn().mockResolvedValue('msg-1');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({ status: 'running', stepCount: 5 });

    const result = await service.executeStep({
      lockRetryAttempt: 12,
      operationId: 'op-exhausted',
      stepIndex: 5,
    });

    expect(scheduleMessage).not.toHaveBeenCalled();
    expect(result.locked).toBe(true);
    expect(result.lockRescheduled).toBeUndefined();
    expect(result.success).toBe(false);
  });

  it('should stay retryable when re-queueing after a lock conflict fails', async () => {
    const scheduleMessage = vi.fn().mockRejectedValue(new Error('qstash down'));
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: { getImpl: () => ({}), scheduleMessage } as any,
    });
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({ status: 'running', stepCount: 5 });

    const result = await service.executeStep({ operationId: 'op-schedule-fail', stepIndex: 5 });

    expect(result.locked).toBe(true);
    expect(result.lockRescheduled).toBeUndefined();
    expect(result.success).toBe(false);
  });

  it('should ack stale duplicate deliveries even when the stale step lock is held', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'running',
      stepCount: 10,
      lastModified: new Date().toISOString(),
    });

    const result = await service.executeStep({
      operationId: 'op-stale-locked',
      stepIndex: 8,
    });

    expect(result.success).toBe(true);
    expect(result.locked).toBeUndefined();
    expect(result.stepResult).toBeNull();
    expect(result.nextStepScheduled).toBe(false);
    expect(coordinator.releaseStepLock).not.toHaveBeenCalled();
  });

  it('keeps a locked completed-step Review retry non-acknowledged for redelivery', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    coordinator.tryClaimStep = vi.fn().mockResolvedValue(false);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      metadata: {
        _agentInterventionLifecycle: { state: 'pending', stepIndex: 0 },
      },
      pendingApprovalBatch: {
        assistantMessageId: 'assistant-1',
        id: 'op-locked-review:1:assistant-1',
        sealed: true,
        stepIndex: 1,
      },
      status: 'waiting_for_human',
      stepCount: 1,
    });

    const result = await service.executeStep({
      externalRetryCount: 1,
      operationId: 'op-locked-review',
      stepIndex: 0,
    });

    expect(result).toMatchObject({
      locked: true,
      nextStepScheduled: false,
      state: { status: 'waiting_for_human' },
      success: false,
    });
    expect(coordinator.releaseStepLock).not.toHaveBeenCalled();
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
    expect(coordinator.releaseStepLock).toHaveBeenCalledWith(
      'op-stale',
      8,
      expect.stringContaining('op-stale:8:'),
    );
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

    expect(coordinator.releaseStepLock).toHaveBeenCalledWith(
      'op-done',
      6,
      expect.stringContaining('op-done:6:'),
    );
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
    expect(coordinator.releaseStepLock).toHaveBeenCalledWith(
      'op-error',
      6,
      expect.stringContaining('op-error:6:'),
    );
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

    expect(coordinator.tryClaimStep).toHaveBeenCalledWith(
      'op-args',
      42,
      120,
      expect.stringContaining('op-args:42:'),
    );
  });

  it('should refresh the step lock while execution is still running', async () => {
    vi.useFakeTimers();
    const service = createService();
    const coordinator = (service as any).coordinator;
    const touchRunning = vi
      .spyOn((service as any).agentOperationModel, 'touchRunning')
      .mockResolvedValue(true);

    try {
      const stopHeartbeat = (service as any).startStepLockHeartbeat('op-heartbeat', 7, 'owner-1');
      await vi.advanceTimersByTimeAsync(30_000);

      expect(coordinator.refreshStepLock).toHaveBeenCalledWith('op-heartbeat', 7, 120, 'owner-1');
      expect(touchRunning).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(coordinator.refreshStepLock).toHaveBeenCalledTimes(3);
      expect(touchRunning).toHaveBeenCalledTimes(1);

      stopHeartbeat();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(coordinator.refreshStepLock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
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

describe('AgentRuntimeService.executeStep - error-path snapshot finalize ()', () => {
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

// step_start event should carry the canonical UIChatMessage[] so the
// client can use the pushed payload as Source of Truth.
describe('AgentRuntimeService.executeStep - step_start uiMessages payload', () => {
  const createService = () => {
    return new AgentRuntimeService({} as any, 'user-1', { queueService: null });
  };

  it('attaches uiMessages to step_start data when topic context is known', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    // Force early-exit path so we don't need to mock the entire runtime
    // execution surface — terminal-state short-circuits right after
    // step_start publishes.
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'done',
      stepCount: 3,
      lastModified: new Date().toISOString(),
      metadata: { agentId: 'agt_1', topicId: 'tpc_1' },
    });
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);

    // Inject a uiMessages-returning messageService — the runtime queries
    // through MessageService (not the bare messageModel) so that file URLs
    // go through FileService postProcessUrl.
    const stubMessages = [{ id: 'msg_1', role: 'user' }];
    (service as any).messageServiceInstance = {
      queryMessages: vi.fn().mockResolvedValue(stubMessages),
    };

    await service.executeStep({
      operationId: 'op-uimsg',
      stepIndex: 5,
      context: { phase: 'user_input' } as any,
    });

    // First publish call is step_start; assert its payload carries uiMessages.
    const stepStartCall = streamManager.publishStreamEvent.mock.calls.find(
      ([, evt]: any) => evt?.type === 'step_start',
    );
    expect(stepStartCall).toBeDefined();
    expect(stepStartCall[1].data.uiMessages).toEqual(stubMessages);
  });

  it('omits uiMessages from step_start data when topic context is unknown', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;
    const streamManager = (service as any).streamManager;

    coordinator.tryClaimStep = vi.fn().mockResolvedValue(true);
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      status: 'done',
      stepCount: 3,
      lastModified: new Date().toISOString(),
      metadata: {}, // no agentId/topicId
    });
    streamManager.publishStreamEvent = vi.fn().mockResolvedValue(undefined);

    const queryMock = vi.fn();
    (service as any).messageServiceInstance = { queryMessages: queryMock };

    await service.executeStep({
      operationId: 'op-noctx',
      stepIndex: 5,
      context: { phase: 'user_input' } as any,
    });

    const stepStartCall = streamManager.publishStreamEvent.mock.calls.find(
      ([, evt]: any) => evt?.type === 'step_start',
    );
    expect(stepStartCall).toBeDefined();
    expect(stepStartCall[1].data).not.toHaveProperty('uiMessages');
    // Did not even attempt the DB query when context is missing.
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('AgentRuntimeService.executeStep - pre-snapshot file-Work registration', () => {
  const runTerminalStep = async (newState: any) => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue({
      lastModified: new Date().toISOString(),
      metadata: {},
      status: 'running',
      stepCount: 1,
    });
    const registerSpy = vi
      .spyOn((service as any).completionLifecycle, 'registerFileWorks')
      .mockResolvedValue(undefined);
    vi.spyOn((service as any).completionLifecycle, 'emitSignalEvents').mockResolvedValue([]);
    vi.spyOn((service as any).completionLifecycle, 'dispatchHooks').mockResolvedValue(undefined);
    (service as any).createAgentRuntime = vi.fn().mockResolvedValue({
      runtime: {
        step: vi.fn().mockResolvedValue({ events: [], newState, nextContext: undefined }),
      },
    });

    await service.executeStep({
      context: { phase: 'agent_step' } as any,
      operationId: 'op-order',
      stepIndex: 2,
    });

    return { registerSpy, saveStepResult: coordinator.saveStepResult };
  };

  const doneState = (status: string) => ({
    lastModified: new Date().toISOString(),
    messages: [],
    metadata: {},
    status,
    stepCount: 2,
  });

  it('registers file works BEFORE the terminal saveStepResult publishes the snapshot', async () => {
    const { registerSpy, saveStepResult } = await runTerminalStep(doneState('done'));

    // The terminal save publishes agent_runtime_end with the uiMessages
    // snapshot the client adopts — the Work rows must already exist by then.
    expect(registerSpy).toHaveBeenCalledWith(
      'op-order',
      expect.objectContaining({ status: 'done' }),
    );
    expect(saveStepResult).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.invocationCallOrder[0]).toBeLessThan(
      saveStepResult.mock.invocationCallOrder[0],
    );
  });

  it('skips pre-save registration for a non-success terminal (error)', async () => {
    const { registerSpy } = await runTerminalStep(doneState('error'));

    expect(registerSpy).not.toHaveBeenCalled();
  });

  // Regression: the park is not a completed deliverable boundary. The fresh
  // continuation sees the complete history and performs the terminal scan;
  // registering here would freeze pre-approval content too early.
  it('skips pre-save registration when parking on waiting_for_human', async () => {
    const { registerSpy } = await runTerminalStep(doneState('waiting_for_human'));

    expect(registerSpy).not.toHaveBeenCalled();
  });
});

describe('AgentRuntimeService.executeStep - Agent Share authorization revoked mid-run', () => {
  it('persists the terminal status through the completion lifecycle when the share is revoked', async () => {
    vi.mocked(createRuntimeExecutors).mockClear();

    const operationId = 'op-share-revoked';
    const verifyShareRunStillAuthorized = vi.fn().mockResolvedValue(false);
    const service = new AgentRuntimeService({} as any, 'user-1', {
      delegate: { verifyShareRunStillAuthorized } as any,
      queueService: null,
    });

    const agentState = {
      lastModified: new Date().toISOString(),
      metadata: { agentShareVisitor: { agentId: 'agent-1', shareId: 'share-1' } },
      status: 'running',
      stepCount: 3,
    };
    const coordinator = (service as any).coordinator;
    coordinator.loadAgentState = vi.fn().mockResolvedValue(agentState);
    coordinator.saveAgentState = vi.fn().mockResolvedValue(undefined);

    const completionLifecycle = (service as any).completionLifecycle;
    const emitSignalEvents = vi
      .spyOn(completionLifecycle, 'emitSignalEvents')
      .mockResolvedValue([]);
    const dispatchHooks = vi
      .spyOn(completionLifecycle, 'dispatchHooks')
      .mockResolvedValue(undefined);

    const result = await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId,
      stepIndex: 4,
    });

    expect(verifyShareRunStillAuthorized).toHaveBeenCalledWith({
      agentId: 'agent-1',
      shareId: 'share-1',
    });
    expect(coordinator.saveAgentState).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({ status: 'interrupted' }),
    );
    expect(emitSignalEvents).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({ status: 'interrupted' }),
      'interrupted',
    );
    expect(dispatchHooks).toHaveBeenCalledWith(
      operationId,
      expect.objectContaining({ status: 'interrupted' }),
      'interrupted',
    );
    // The run must abort before any model/tool work happens
    expect(createRuntimeExecutors).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nextStepScheduled: false,
      state: { status: 'interrupted' },
      stepResult: null,
      success: false,
    });

    emitSignalEvents.mockRestore();
    dispatchHooks.mockRestore();
  });
});
