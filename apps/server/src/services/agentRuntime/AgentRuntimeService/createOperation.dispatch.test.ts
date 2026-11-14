// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { type OperationCreationParams } from '../types';
import { createOperation, type CreateOperationDeps } from './createOperation';
import { executeStep, type ExecuteStepDeps } from './executeStep';

const params = {
  agentConfig: {},
  appContext: {},
  initialContext: { phase: 'user_input' },
  modelRuntimeConfig: { model: 'test' },
  operationId: 'dispatch-failure',
  toolSet: { manifestMap: {} },
  userId: 'test-user',
} as OperationCreationParams;

const setup = () => {
  const failure = new Error('queue publish timed out');
  const recordDispatchFailure = vi.fn().mockResolvedValue(true);
  const deps = {
    agentOperationModel: { recordDispatchFailure },
    baseURL: 'http://localhost/api/agent',
    completionLifecycle: { recordStart: vi.fn().mockResolvedValue(true) },
    coordinator: { createAgentOperation: vi.fn(), saveAgentState: vi.fn() },
    queueService: { scheduleMessage: vi.fn().mockRejectedValue(failure) },
    resolveLlmExecutor: vi.fn(),
  } as unknown as CreateOperationDeps;
  return { deps, failure, recordDispatchFailure };
};

describe('operation dispatch failure', () => {
  it('durably settles a rejected first delivery before exposing its error', async () => {
    const { deps, failure, recordDispatchFailure } = setup();
    await expect(createOperation(deps, params)).rejects.toBe(failure);
    expect(recordDispatchFailure).toHaveBeenCalledWith(params.operationId, failure.message);
  });

  it('awaits the durable failure write before rejecting', async () => {
    const { deps, recordDispatchFailure } = setup();
    let finish!: () => void;
    recordDispatchFailure.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let rejected = false;
    const result = createOperation(deps, params).catch(() => {
      rejected = true;
    });
    await vi.waitFor(() => expect(recordDispatchFailure).toHaveBeenCalled());
    expect(rejected).toBe(false);
    finish();
    await result;
    expect(rejected).toBe(true);
  });

  it('leaves a prepared intervention continuation running for its own recovery', async () => {
    const { deps, failure, recordDispatchFailure } = setup();
    const interventionResolution = {
      resolutionRequestId: 'resolution-1',
      sourceOperationId: 'source-operation',
      sourceToolMessageIds: ['tool-message-1'],
    };
    Object.assign(deps.agentOperationModel, {
      findById: vi.fn().mockResolvedValue({
        metadata: { agentInterventionContinuation: interventionResolution },
        status: 'running',
      }),
      recordAgentInterventionPreparation: vi.fn().mockResolvedValue(true),
    });
    Object.assign(deps.coordinator, {
      loadAgentState: vi.fn().mockResolvedValue({ metadata: {} }),
    });

    await expect(createOperation(deps, { ...params, interventionResolution })).rejects.toBe(
      failure,
    );
    expect(recordDispatchFailure).not.toHaveBeenCalled();
  });

  it('keeps a successful first delivery running', async () => {
    const { deps, recordDispatchFailure } = setup();
    vi.mocked(deps.queueService!.scheduleMessage).mockResolvedValue('queued');
    await expect(createOperation(deps, params)).resolves.toMatchObject({ autoStarted: true });
    expect(recordDispatchFailure).not.toHaveBeenCalled();
  });
});

describe('uncertain delivery of a terminal operation', () => {
  it.each(['error', 'interrupted', 'done', 'abandoned'] as const)(
    'ACKs %s without entering model or tool execution',
    async (status) => {
      const createAgentRuntime = vi.fn();
      const tryClaimStep = vi.fn();
      const deps = {
        agentOperationModel: { findById: vi.fn().mockResolvedValue({ status }) },
        coordinator: { tryClaimStep },
        createAgentRuntime,
      } as unknown as ExecuteStepDeps;
      await expect(
        executeStep(deps, { operationId: params.operationId, stepIndex: 0 }),
      ).resolves.toMatchObject({
        success: true,
        nextStepScheduled: false,
        stepResult: null,
      });
      expect(createAgentRuntime).not.toHaveBeenCalled();
      expect(tryClaimStep).not.toHaveBeenCalled();
    },
  );

  it('refuses execution when the durable terminal status cannot be read', async () => {
    const error = new Error('operation database unavailable');
    const tryClaimStep = vi.fn();
    const deps = {
      agentOperationModel: { findById: vi.fn().mockRejectedValue(error) },
      coordinator: { tryClaimStep },
    } as unknown as ExecuteStepDeps;
    await expect(
      executeStep(deps, { operationId: params.operationId, stepIndex: 0 }),
    ).rejects.toMatchObject({ cause: error, name: 'DurableStatusUnavailableError' });
    expect(tryClaimStep).not.toHaveBeenCalled();
  });
});
