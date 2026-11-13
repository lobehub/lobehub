import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecRunContext } from '../../types';
import type { HeteroDispatchDeps, HeteroDispatchInput } from '.';
import { dispatchHeteroAgent } from '.';

const mocks = vi.hoisted(() => {
  const spans = { ended: [] as string[], failed: [] as string[] };
  return {
    afterWork: [] as (() => Promise<unknown> | unknown)[],
    completeOperation: vi.fn(),
    createOperationMetadata: vi.fn(),
    dispatchAgentRun: vi.fn(),
    executeToolCall: vi.fn(),
    featureFlags: vi.fn(),
    finalizeHeteroDispatchError: vi.fn(),
    findByDeviceId: vi.fn(),
    isRunningOnTopic: vi.fn(),
    planDeviceRouting: vi.fn(),
    publishAgentRuntimeInit: vi.fn(),
    recordStart: vi.fn(),
    resolveDeviceDispatchAuthorizationFailure: vi.fn(),
    resolveSandboxSessionConfig: vi.fn(),
    selectCodexDeviceDispatch: vi.fn(),
    signHeteroOperationJWT: vi.fn(),
    signUserJWT: vi.fn(),
    span: (name: string) => ({
      end: vi.fn(() => spans.ended.push(name)),
      setAttribute: vi.fn(),
      setStatus: vi.fn(() => spans.failed.push(name)),
    }),
    spans,
    waitForVerifyPlan: vi.fn(),
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  tracer: {
    startActiveSpan: (name: string, fn: (span: unknown) => unknown) => fn(mocks.span(name)),
  },
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.featureFlags,
}));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  afterUnscoped: (work: () => Promise<unknown> | unknown) => {
    mocks.afterWork.push(work);
  },
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { isRunningOnTopic: mocks.isRunningOnTopic };
  }),
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  findWakeableManagedDevices: vi.fn().mockResolvedValue([]),
  waitForManagedDeviceOnline: vi.fn(),
  wakeManagedDevice: vi.fn(),
}));

vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn().mockImplementation(function () {
    return {
      completeOperation: mocks.completeOperation,
      recordStart: mocks.recordStart,
      waitForVerifyPlan: mocks.waitForVerifyPlan,
    };
  }),
}));

vi.mock('@/server/services/agentRuntime/hooks', () => ({
  hookDispatcher: {
    canDeliver: vi.fn().mockReturnValue(false),
    getSerializedHooks: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(function () {
    return { getHeterogeneousResumeSessionId: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signHeteroOperationJWT: mocks.signHeteroOperationJWT,
  signUserJWT: mocks.signUserJWT,
}));

vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createAgentStateManager: () => ({ createOperationMetadata: mocks.createOperationMetadata }),
  createStreamEventManager: () => ({ publishAgentRuntimeInit: mocks.publishAgentRuntimeInit }),
}));

vi.mock('@/server/services/agentQuota', () => ({
  AgentQuotaService: vi.fn(function () {
    return {
      planDeviceRouting: mocks.planDeviceRouting,
      resolveDeviceRowId: async (id?: string) => (id ? `row-${id}` : undefined),
    };
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    dispatchAgentRun: mocks.dispatchAgentRun,
    executeToolCall: mocks.executeToolCall,
    readDeviceSystemInfo: vi.fn(),
  },
}));

vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: mocks.resolveDeviceDispatchAuthorizationFailure,
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findByDeviceId: mocks.findByDeviceId,
      findWorkspaceDeviceById: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/server/services/sandbox/session', () => ({
  resolveSandboxSessionConfig: mocks.resolveSandboxSessionConfig,
}));

vi.mock('../finalizeHeteroDispatchError', () => ({
  finalizeHeteroDispatchError: mocks.finalizeHeteroDispatchError,
}));

vi.mock('./timeoutConfirmation', () => ({ scheduleTimedOutDispatchConfirmation: vi.fn() }));

vi.mock('../codexDeviceRuntime', () => ({
  selectCodexDeviceDispatch: mocks.selectCodexDeviceDispatch,
}));

/** Resolves only once `count` callers wait on it: sequential callers deadlock. */
const createBarrier = (count: number) => {
  const started: string[] = [];
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    gate:
      <T>(stage: string, value: T) =>
      async () => {
        started.push(stage);
        if (started.length >= count) open();
        await opened;
        return value;
      },
    started,
  };
};

const createDeps = (overrides: Partial<HeteroDispatchDeps> = {}) => {
  const topicModel = {
    appendRunningOperationChild: vi.fn().mockResolvedValue(true),
    findById: vi.fn().mockResolvedValue({ metadata: {} }),
    patchRunningOperation: vi.fn().mockResolvedValue(true),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    bindTopicWorkingDirectory: vi.fn().mockResolvedValue(undefined),
    db: {} as any,
    getMarketService: vi.fn().mockRejectedValue(new Error('market unavailable')),
    messageModel: { query: vi.fn().mockResolvedValue([]) } as any,
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
    topicModel: topicModel as any,
    userId: 'user-1',
    withholdGatewayToken: false,
    ...overrides,
  } satisfies HeteroDispatchDeps;
  return { deps, topicModel };
};

const deviceCtx = (overrides: Partial<ExecRunContext> = {}): ExecRunContext =>
  ({
    agentConfig: {
      agencyConfig: {
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      },
      id: 'agent-1',
      userId: 'user-1',
    },
    assistantMessageId: 'asst-1',
    canUseDevice: true,
    deviceAccessReason: 'owner',
    parentMessageId: 'parent-1',
    persistAgentId: 'agent-1',
    prompt: 'hello',
    resolvedAgentId: 'agent-1',
    runFacts: {} as any,
    topicId: 'topic-1',
    trigger: 'chat',
    userMessageId: 'user-msg-1',
    ...overrides,
  }) as ExecRunContext;

const plainInput = (overrides: Partial<HeteroDispatchInput> = {}): HeteroDispatchInput => ({
  canManageAgent: true,
  hasOrchestration: false,
  heteroType: 'claude-code',
  isPublicWorkspaceAgent: false,
  runAttachments: { audioList: [], fileList: [], imageList: [], videoList: [] },
  selfMessageIds: new Set(),
  ...overrides,
});

const runAfterResponse = async () => {
  const work = mocks.afterWork.splice(0);
  for (const fn of work) await fn();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterWork.length = 0;
  mocks.spans.ended.length = 0;
  mocks.spans.failed.length = 0;
  mocks.featureFlags.mockResolvedValue({ enableDeferredHeteroDispatch: false });
  mocks.isRunningOnTopic.mockResolvedValue(true);
  mocks.recordStart.mockResolvedValue(true);
  mocks.waitForVerifyPlan.mockResolvedValue(undefined);
  mocks.signHeteroOperationJWT.mockResolvedValue('op-jwt');
  mocks.signUserJWT.mockResolvedValue('user-jwt');
  mocks.finalizeHeteroDispatchError.mockResolvedValue(true);
  mocks.findByDeviceId.mockResolvedValue(undefined);
  mocks.resolveDeviceDispatchAuthorizationFailure.mockResolvedValue(undefined);
  mocks.resolveSandboxSessionConfig.mockResolvedValue(undefined);
  mocks.selectCodexDeviceDispatch.mockResolvedValue({ kind: 'exec' });
  mocks.dispatchAgentRun.mockResolvedValue({ success: true });
  mocks.planDeviceRouting.mockResolvedValue(null);
  mocks.publishAgentRuntimeInit.mockResolvedValue('init');
  mocks.createOperationMetadata.mockResolvedValue(undefined);
});

describe('dispatchHeteroAgent — overlapping waits', () => {
  it('prepares and routes the run while it waits for the verify plan', async () => {
    const barrier = createBarrier(3);
    mocks.waitForVerifyPlan.mockImplementation(barrier.gate('verify', undefined));
    mocks.signHeteroOperationJWT.mockImplementation(barrier.gate('jwt', 'op-jwt'));
    const { deps } = createDeps({
      resolveDeviceWorkspaceId: vi.fn(barrier.gate('routing', undefined)),
    });

    const result = await dispatchHeteroAgent(deps, deviceCtx(), plainInput());

    expect(barrier.started.toSorted()).toEqual(['jwt', 'routing', 'verify']);
    expect(result.success).toBe(true);
    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
  });

  it('reads the Codex runtime, the device row and the account routing together', async () => {
    const barrier = createBarrier(3);
    mocks.selectCodexDeviceDispatch.mockImplementation(barrier.gate('codex', { kind: 'exec' }));
    mocks.findByDeviceId.mockImplementation(barrier.gate('device', undefined));
    mocks.planDeviceRouting.mockImplementation(barrier.gate('account', null));
    const { deps } = createDeps();

    await dispatchHeteroAgent(deps, deviceCtx(), plainInput());

    expect(barrier.started.toSorted()).toEqual(['account', 'codex', 'device']);
    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the Codex runtime refuses the run', async () => {
    mocks.selectCodexDeviceDispatch.mockResolvedValue({ kind: 'error', message: 'too old' });
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(deps, deviceCtx(), plainInput());

    expect(result.success).toBe(false);
    expect(deps.bindTopicWorkingDirectory).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('fails closed when the registry recheck throws', async () => {
    mocks.resolveDeviceDispatchAuthorizationFailure.mockRejectedValue(new Error('db down'));
    const { deps } = createDeps();

    await expect(dispatchHeteroAgent(deps, deviceCtx(), plainInput())).rejects.toThrow('db down');
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.spans.failed).toContain('hetero_dispatch device authorization');
    expect(mocks.spans.ended).toContain('hetero_dispatch device authorization');
  });

  it('closes the span of a stage that throws and records its error', async () => {
    mocks.recordStart.mockRejectedValue(new Error('insert failed'));
    const { deps } = createDeps();

    await expect(dispatchHeteroAgent(deps, deviceCtx(), plainInput())).rejects.toThrow(
      'insert failed',
    );
    expect(mocks.spans.failed).toEqual(['hetero_dispatch record_start']);
    expect(mocks.spans.ended).toEqual(['hetero_dispatch record_start']);
  });
});

describe('dispatchHeteroAgent — agent_deferred_hetero_dispatch', () => {
  beforeEach(() => {
    mocks.featureFlags.mockResolvedValue({ enableDeferredHeteroDispatch: true });
  });

  it('answers a plain chat send before the device dispatch, then dispatches', async () => {
    const { deps, topicModel } = createDeps();

    const result = await dispatchHeteroAgent(deps, deviceCtx(), plainInput());

    expect(result).toMatchObject({ status: 'created', success: true, token: 'user-jwt' });
    // The marker naming the device is written before the response, so a stop
    // request can reach the run as soon as the client has it.
    expect(topicModel.updateMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({
        runningOperation: expect.objectContaining({ deviceId: 'dev-1' }),
      }),
    );
    expect(mocks.publishAgentRuntimeInit).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();

    await runAfterResponse();

    expect(mocks.dispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-1', operationId: result.operationId }),
    );
    expect(topicModel.patchRunningOperation).toHaveBeenCalledTimes(1);
    expect(mocks.spans.ended).toContain('hetero_dispatch deferred_device_dispatch');
  });

  it('puts a refused deferred dispatch on the assistant message', async () => {
    mocks.dispatchAgentRun.mockResolvedValue({ error: 'DEVICE_OFFLINE', success: false });
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(deps, deviceCtx(), plainInput());
    expect(result.success).toBe(true);

    await runAfterResponse();

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        assistantMessageId: 'asst-1',
        detail: 'DEVICE_OFFLINE',
        operationId: result.operationId,
      }),
    );
  });

  it('settles a deferred dispatch that throws as the run error', async () => {
    mocks.resolveDeviceDispatchAuthorizationFailure.mockRejectedValue(new Error('db down'));
    const { deps } = createDeps();

    await dispatchHeteroAgent(deps, deviceCtx(), plainInput());
    await runAfterResponse();

    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        detail: 'db down',
        message: 'Hetero agent device dispatch failed',
      }),
    );
  });

  it('does not dispatch a run stopped while its dispatch prepared', async () => {
    // Live when the deferred work starts, stopped by the time the device steps finish.
    mocks.isRunningOnTopic.mockResolvedValueOnce(true).mockResolvedValue(false);
    const { deps, topicModel } = createDeps();

    await dispatchHeteroAgent(deps, deviceCtx(), plainInput());
    await runAfterResponse();

    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
    expect(topicModel.patchRunningOperation).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).not.toHaveBeenCalled();
  });

  it('cancels on the device a run stopped during the gateway hop', async () => {
    mocks.isRunningOnTopic
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    mocks.executeToolCall.mockResolvedValue({ success: true });
    const { deps, topicModel } = createDeps();

    const result = await dispatchHeteroAgent(deps, deviceCtx(), plainInput());
    await runAfterResponse();

    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-1' }),
      expect.objectContaining({
        apiName: 'cancelHeteroTask',
        arguments: JSON.stringify({ signal: 'SIGINT', taskId: result.operationId }),
      }),
      10_000,
    );
    expect(topicModel.patchRunningOperation).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).not.toHaveBeenCalled();
  });

  it('does not dispatch a run stopped before the deferred dispatch started', async () => {
    mocks.isRunningOnTopic.mockResolvedValue(false);
    const { deps } = createDeps();

    await dispatchHeteroAgent(deps, deviceCtx(), plainInput());
    await runAfterResponse();

    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<ExecRunContext>, Partial<HeteroDispatchInput>]>([
    ['an orchestrated caller', {}, { hasOrchestration: true }],
    ['a caller that does not say', {}, { hasOrchestration: undefined }],
    ['a Task run', {}, { operationTaskId: 'task-1' }],
    ['a bot message', { trigger: 'bot' }, {}],
  ])('dispatches synchronously for %s without reading the flag', async (_, ctx, input) => {
    const { deps } = createDeps();

    await dispatchHeteroAgent(deps, deviceCtx(ctx), plainInput(input));

    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.afterWork).toHaveLength(0);
    expect(mocks.featureFlags).not.toHaveBeenCalled();
  });

  it('dispatches synchronously while the flag is off', async () => {
    mocks.featureFlags.mockResolvedValue({ enableDeferredHeteroDispatch: false });
    const { deps } = createDeps();

    await dispatchHeteroAgent(deps, deviceCtx(), plainInput());

    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.afterWork).toHaveLength(0);
  });
});
