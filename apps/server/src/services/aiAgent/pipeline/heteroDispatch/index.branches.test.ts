import { HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR } from '@lobechat/heterogeneous-agents';
import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  humanizeHeteroDispatchError,
  resolveHeteroDispatchErrorType,
} from '../../helpers/heteroErrors';
import type { ExecRunContext } from '../../types';
import type { HeteroDispatchDeps, HeteroDispatchInput } from '.';
import { dispatchHeteroAgent } from '.';

const mocks = vi.hoisted(() => ({
  completeOperation: vi.fn(),
  createOperationMetadata: vi.fn(),
  dispatchAgentRun: vi.fn(),
  executeToolCall: vi.fn(),
  finalizeHeteroDispatchError: vi.fn(),
  planDeviceRouting: vi.fn(),
  publishAgentRuntimeInit: vi.fn(),
  readDeviceSystemInfo: vi.fn(),
  recordStart: vi.fn(),
  resolveDeviceDispatchAuthorizationFailure: vi.fn(),
  resolveSandboxSessionConfig: vi.fn(),
  scheduleTimedOutDispatchConfirmation: vi.fn(),
  selectCodexDeviceDispatch: vi.fn(),
  signHeteroOperationJWT: vi.fn(),
  signUserJWT: vi.fn(),
  spawnHeteroSandbox: vi.fn(),
}));

vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn().mockImplementation(function () {
    return { completeOperation: mocks.completeOperation, recordStart: mocks.recordStart };
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
    return { planDeviceRouting: mocks.planDeviceRouting };
  }),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    dispatchAgentRun: mocks.dispatchAgentRun,
    executeToolCall: mocks.executeToolCall,
    readDeviceSystemInfo: mocks.readDeviceSystemInfo,
  },
}));

vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: mocks.resolveDeviceDispatchAuthorizationFailure,
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findByDeviceId: vi.fn().mockResolvedValue(undefined),
      findWorkspaceDeviceById: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/server/services/sandbox/session', () => ({
  resolveSandboxSessionConfig: mocks.resolveSandboxSessionConfig,
}));

vi.mock('@/server/services/heterogeneousAgent/sandboxRunner', () => ({
  spawnHeteroSandbox: mocks.spawnHeteroSandbox,
}));

vi.mock('../finalizeHeteroDispatchError', () => ({
  finalizeHeteroDispatchError: mocks.finalizeHeteroDispatchError,
}));

vi.mock('./timeoutConfirmation', () => ({
  scheduleTimedOutDispatchConfirmation: mocks.scheduleTimedOutDispatchConfirmation,
}));

vi.mock('../codexDeviceRuntime', () => ({
  selectCodexDeviceDispatch: mocks.selectCodexDeviceDispatch,
}));

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

const createCtx = (
  agencyConfig: Record<string, unknown>,
  overrides: Partial<ExecRunContext> = {},
): ExecRunContext =>
  ({
    agentConfig: { agencyConfig, id: 'agent-1', userId: 'author-1' },
    assistantMessageId: 'asst-1',
    canUseDevice: true,
    deviceAccessReason: 'owner',
    model: 'model',
    parentMessageId: 'parent-1',
    persistAgentId: 'agent-1',
    prompt: 'hello',
    provider: 'provider',
    resolvedAgentId: 'agent-1',
    runFacts: {} as any,
    topicId: 'topic-1',
    userMessageId: 'user-msg-1',
    ...overrides,
  }) as ExecRunContext;

const createInput = (
  heteroType: HeteroDispatchInput['heteroType'],
  overrides: Partial<HeteroDispatchInput> = {},
): HeteroDispatchInput => ({
  canManageAgent: true,
  heteroType,
  isPublicWorkspaceAgent: false,
  runAttachments: { audioList: [], fileList: [], imageList: [], videoList: [] },
  selfMessageIds: new Set(),
  ...overrides,
});

const errorResult = (fields: Record<string, unknown>) => ({
  agentId: 'agent-1',
  assistantMessageId: 'asst-1',
  autoStarted: false,
  createdAt: expect.any(String),
  operationId: expect.stringMatching(/^op_\d+_agent-1_topic-1_/),
  status: 'error',
  success: false,
  terminalReported: true,
  timestamp: expect.any(String),
  topicId: 'topic-1',
  userMessageId: 'user-msg-1',
  ...fields,
});

const finalizeParams = (fields: Record<string, unknown>) => ({
  agentId: 'agent-1',
  assistantMessageId: 'asst-1',
  operationId: expect.stringMatching(/^op_/),
  topicId: 'topic-1',
  ...fields,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordStart.mockResolvedValue(true);
  mocks.signHeteroOperationJWT.mockResolvedValue('op-jwt');
  mocks.signUserJWT.mockResolvedValue('user-jwt');
  mocks.finalizeHeteroDispatchError.mockResolvedValue(true);
  mocks.resolveDeviceDispatchAuthorizationFailure.mockResolvedValue(undefined);
  mocks.resolveSandboxSessionConfig.mockResolvedValue(undefined);
  mocks.selectCodexDeviceDispatch.mockResolvedValue({ kind: 'exec' });
  mocks.dispatchAgentRun.mockResolvedValue({ success: true });
  mocks.planDeviceRouting.mockResolvedValue(null);
  mocks.executeToolCall.mockResolvedValue({ success: true });
  mocks.spawnHeteroSandbox.mockResolvedValue(undefined);
  mocks.publishAgentRuntimeInit.mockResolvedValue('init');
  mocks.createOperationMetadata.mockResolvedValue(undefined);
});

describe('Channel history context', () => {
  it.each([true, false])(
    'passes history instructions only for a reserved Channel run (%s)',
    async (channel) => {
      const { deps } = createDeps();
      const result = await dispatchHeteroAgent(
        deps,
        createCtx(
          {
            boundDeviceId: 'dev-1',
            executionTarget: 'device',
            heterogeneousProvider: { type: 'claude-code' },
          },
          { trigger: channel ? 'channel' : 'user' },
        ),
        createInput('claude-code', channel ? { reservedOperationId: 'op-channel' } : {}),
      );
      expect(result.success).toBe(true);
      const dispatched = mocks.dispatchAgentRun.mock.calls[0][0];
      expect((dispatched.systemContext ?? '').includes('channel history --json')).toBe(channel);
      expect((dispatched.systemContext ?? '').includes('Only the current request')).toBe(channel);
      const signed = mocks.signHeteroOperationJWT.mock.calls[0][0];
      expect(signed.capabilities.includes('channel:read')).toBe(channel);
    },
  );
});

describe('dispatchHeteroAgent — preparation failures', () => {
  it('fails before dispatch when the operation JWT cannot be signed', async () => {
    mocks.signHeteroOperationJWT.mockRejectedValueOnce(new Error('no key'));
    const { deps } = createDeps();

    await expect(
      dispatchHeteroAgent(
        deps,
        createCtx({ heterogeneousProvider: { type: 'claude-code' } }),
        createInput('claude-code'),
      ),
    ).rejects.toThrow('Failed to sign operation JWT for hetero agent');
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.spawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('rejects a provider-bound (API auth) agent before any dispatch', async () => {
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({
        executionTarget: 'sandbox',
        heterogeneousProvider: { authMode: 'api', type: 'claude-code' },
      }),
      createInput('claude-code'),
    );

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({
        detail: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
        message: 'Provider-bound heterogeneous agents do not support this execution target',
      }),
    );
    expect(result).toStrictEqual(
      errorResult({
        error: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
        message: 'Heterogeneous agent provider binding requires Desktop local execution',
      }),
    );
    expect(mocks.spawnHeteroSandbox).not.toHaveBeenCalled();
  });
});

describe('dispatchHeteroAgent — remote platform agents', () => {
  const remoteConfig = (extra: Record<string, unknown> = {}) => ({
    executionTarget: 'device',
    heterogeneousProvider: { platformAgentId: 'platform-agent', type: 'openclaw' },
    ...extra,
  });

  it('refuses a sender without device access', async () => {
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx(remoteConfig({ boundDeviceId: 'dev-1' }), { canUseDevice: false }),
      createInput('openclaw'),
    );

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({
        detail: 'This sender is not allowed to run agents on a bound device.',
        message: 'Device access denied',
      }),
    );
    expect(result).toStrictEqual(
      errorResult({
        error: 'Device access denied',
        message: 'Remote hetero agent requires device access',
      }),
    );
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
  });

  it('fails when no device is available', async () => {
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx(remoteConfig()),
      createInput('openclaw'),
    );

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({
        detail: 'No local or connected device is available for this agent.',
        message: 'No execution device for platform agent',
      }),
    );
    expect(result).toStrictEqual(
      errorResult({
        error: 'No bound device',
        message: 'Platform agent requires a local or connected device',
      }),
    );
  });

  it('settles a failed device dispatch with the routed device on the error', async () => {
    const errorData = { code: 'DEVICE_NOT_FOUND', deviceId: 'dev-1', retryable: true };
    mocks.executeToolCall.mockResolvedValueOnce({
      error: 'DEVICE_NOT_FOUND',
      errorData,
      success: false,
    });
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx(remoteConfig({ boundDeviceId: 'dev-1' })),
      createInput('openclaw'),
    );

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({
        detail: 'DEVICE_NOT_FOUND',
        deviceRoute: { deviceId: 'dev-1', userId: 'author-1' },
        errorData,
        errorType: resolveHeteroDispatchErrorType('DEVICE_NOT_FOUND'),
        message: humanizeHeteroDispatchError('DEVICE_NOT_FOUND'),
      }),
    );
    expect(result).toStrictEqual(
      errorResult({
        error: 'DEVICE_NOT_FOUND',
        errorData,
        message: 'Remote hetero agent dispatch failed',
      }),
    );
  });

  it('dispatches runHeteroTask to the bound device under the author principal', async () => {
    const { deps, topicModel } = createDeps({ workspaceId: 'ws-1' });

    const result = await dispatchHeteroAgent(
      deps,
      createCtx(remoteConfig({ boundDeviceId: 'dev-1' })),
      createInput('openclaw'),
    );

    expect(mocks.executeToolCall).toHaveBeenCalledWith(
      { deviceId: 'dev-1', userId: 'author-1', workspaceId: undefined },
      expect.objectContaining({ apiName: 'runHeteroTask', identifier: 'runHeteroTask' }),
      120_000,
    );
    const args = JSON.parse(mocks.executeToolCall.mock.calls[0][1].arguments);
    expect(args).toEqual({
      agentId: 'agent-1',
      agentType: 'openclaw',
      operationId: result.operationId,
      platformAgentId: 'platform-agent',
      prompt: 'hello',
      taskId: result.operationId,
      topicId: 'topic-1',
      workspaceId: 'ws-1',
    });
    expect(topicModel.updateMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({
        runningOperation: expect.objectContaining({
          deviceId: 'dev-1',
          deviceUserId: 'author-1',
          heteroType: 'openclaw',
          operationId: result.operationId,
        }),
      }),
    );
    expect(mocks.publishAgentRuntimeInit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      autoStarted: true,
      heteroType: 'openclaw',
      status: 'created',
      success: true,
      token: 'user-jwt',
    });
  });
});

describe('dispatchHeteroAgent — local CLI agents', () => {
  it.each([
    [
      'claude-code',
      'No device bound. Pick a device in the Execution Device switcher, or switch to Cloud sandbox.',
    ],
    ['amp', 'No device bound. Pick a local or connected device in the Execution Device switcher.'],
  ] as const)('fails an unrouted %s device run', async (heteroType, detail) => {
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({ executionTarget: 'device', heterogeneousProvider: { type: heteroType } }),
      createInput(heteroType),
    );

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({ detail, message: 'No bound device for hetero agent' }),
    );
    expect(result).toStrictEqual(
      errorResult({ error: 'No bound device', message: 'Hetero agent requires a bound device' }),
    );
  });

  it('settles a rejected native Codex selection', async () => {
    mocks.selectCodexDeviceDispatch.mockResolvedValueOnce({
      kind: 'error',
      message: 'Codex is too old',
    });
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'codex' },
      }),
      createInput('codex'),
    );

    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({ detail: 'Codex is too old', message: 'Native Codex dispatch rejected' }),
    );
    expect(result).toStrictEqual(
      errorResult({ error: 'Codex is too old', message: 'Codex is too old' }),
    );
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('settles a device whose dispatch authorization was revoked', async () => {
    const errorData = { code: 'DEVICE_NOT_FOUND', deviceId: 'dev-1', retryable: true };
    mocks.resolveDeviceDispatchAuthorizationFailure.mockResolvedValueOnce(errorData);
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
      createInput('claude-code'),
    );

    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({
        detail: 'DEVICE_NOT_FOUND',
        deviceRoute: { deviceId: 'dev-1', userId: 'user-1' },
        errorData,
        errorType: resolveHeteroDispatchErrorType('DEVICE_NOT_FOUND'),
        message: humanizeHeteroDispatchError('DEVICE_NOT_FOUND'),
      }),
    );
    expect(result).toStrictEqual(
      errorResult({
        error: 'DEVICE_NOT_FOUND',
        errorData,
        message: 'Hetero agent device dispatch failed',
      }),
    );
  });

  it('dispatches to the bound device and records the device route', async () => {
    const { deps, topicModel } = createDeps({ workspaceId: 'ws-1' });

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
      createInput('claude-code'),
    );

    expect(mocks.dispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        agentType: 'claude-code',
        deviceId: 'dev-1',
        ingestWorkspaceId: 'ws-1',
        jwt: 'op-jwt',
        operationId: result.operationId,
        prompt: 'hello',
        topicId: 'topic-1',
        userId: 'user-1',
        workspaceId: undefined,
      }),
    );
    expect(deps.bindTopicWorkingDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-1', topicId: 'topic-1' }),
    );
    expect(topicModel.patchRunningOperation).toHaveBeenCalledWith('topic-1', result.operationId, {
      deviceId: 'dev-1',
      deviceWorkspaceId: undefined,
      heteroType: 'claude-code',
    });
    expect(result).toMatchObject({ status: 'created', success: true, token: 'user-jwt' });
  });

  it('sends the Claude Code account the agent is routed to', async () => {
    // Without it the device always spawned on its default login, so picking an
    // account in Manage accounts changed nothing for a device-bound agent.
    const routing = { candidates: [{ externalAccountId: 'acc-1' }], mode: 'pinned' };
    mocks.planDeviceRouting.mockResolvedValueOnce(routing);
    const { deps } = createDeps();
    const deviceCtx = {
      boundDeviceId: 'dev-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };

    await dispatchHeteroAgent(deps, createCtx(deviceCtx), createInput('claude-code'));

    expect(mocks.planDeviceRouting).toHaveBeenCalledWith('agent-1', { provider: 'claude-code' });
    expect(mocks.dispatchAgentRun.mock.calls[0][0].claudeAccountRouting).toEqual(routing);
  });

  it('dispatches without account routing when the agent env picks the login or routing fails', async () => {
    const { deps } = createDeps();

    await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
      createInput('claude-code', {
        heterogeneousProvider: { env: { ANTHROPIC_API_KEY: 'sk' }, type: 'claude-code' },
      }),
    );
    expect(mocks.planDeviceRouting).not.toHaveBeenCalled();

    mocks.planDeviceRouting.mockRejectedValueOnce(new Error('db down'));
    await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
      createInput('claude-code'),
    );

    expect(mocks.dispatchAgentRun).toHaveBeenCalledTimes(2);
    for (const [params] of mocks.dispatchAgentRun.mock.calls)
      expect(params).not.toHaveProperty('claudeAccountRouting');
  });

  it('spawns in the source repo and names the active worktree in the context', async () => {
    // The agent created this worktree last turn and may have removed it since:
    // spawning in it failed every later turn with working_directory_not_found.
    const workingDirectoryConfig = {
      git: { activeWorktree: '/repo-wt-21058' },
      path: '/repo',
      repoType: 'github' as const,
    };
    const { deps, topicModel } = createDeps();
    topicModel.findById.mockResolvedValue({
      metadata: { boundDeviceId: 'dev-1', workingDirectory: '/repo', workingDirectoryConfig },
    });

    await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
      createInput('claude-code'),
    );

    const dispatched = mocks.dispatchAgentRun.mock.calls[0][0];
    expect(dispatched.cwd).toBe('/repo');
    expect(dispatched.systemContext).toContain('/repo-wt-21058');
    // The worktree stays on the topic as the selected one; only the spawn cwd moved.
    expect(deps.bindTopicWorkingDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ config: workingDirectoryConfig }),
    );
  });

  it('keeps the active worktree writable for a sandboxed Codex run in the source repo', async () => {
    // `--full-auto` sandboxes Codex to its cwd, and the worktree sits beside the repo.
    const { deps, topicModel } = createDeps();
    topicModel.findById.mockResolvedValue({
      metadata: {
        boundDeviceId: 'dev-1',
        workingDirectory: '/repo',
        workingDirectoryConfig: { git: { activeWorktree: '/repo-wt-21058' }, path: '/repo' },
      },
    });

    await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'codex' },
      }),
      createInput('codex', {
        heterogeneousProvider: { args: ['--full-auto'], type: 'codex' },
      }),
    );

    const dispatched = mocks.dispatchAgentRun.mock.calls[0][0];
    expect(dispatched.cwd).toBe('/repo');
    expect(dispatched.args).toEqual([
      '--agent-arg=--full-auto',
      '--agent-arg=-c',
      '--agent-arg=sandbox_workspace_write.writable_roots=["/repo-wt-21058"]',
    ]);
  });

  it('keeps a timed-out dispatch alive and settles it later as a device timeout', async () => {
    // Whether the run started is unknowable after a timeout: the device may
    // have received it before the ack was lost, and its CLI may already be
    // starting. Failing it now would refuse that CLI's first batch as
    // `operation-not-running`; asking the device now must not decide it either.
    const raw = JSON.stringify({ error: 'TIMEOUT', success: false, timeSinceHeartbeatMs: 70_000 });
    mocks.dispatchAgentRun.mockResolvedValueOnce({ error: raw, success: false });
    mocks.readDeviceSystemInfo.mockResolvedValue({ ok: false, reason: 'DEVICE_OFFLINE' });
    const { deps, topicModel } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
      createInput('claude-code'),
    );

    expect(mocks.finalizeHeteroDispatchError).not.toHaveBeenCalled();
    expect(mocks.scheduleTimedOutDispatchConfirmation).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ operationId: result.operationId }),
      {
        dispatchedAt: expect.any(Date),
        finalize: expect.objectContaining({
          detail: raw,
          errorType: ChatErrorType.DeviceResponseTimeout,
          message: humanizeHeteroDispatchError('DEVICE_RESPONSE_TIMEOUT'),
        }),
        result: expect.objectContaining({ error: raw }),
      },
    );
    // Stop must still reach a run that may be live on the device.
    expect(topicModel.patchRunningOperation).toHaveBeenCalledWith(
      'topic-1',
      result.operationId,
      expect.objectContaining({ deviceId: 'dev-1' }),
    );
    expect(result).toMatchObject({ status: 'created', success: true });
    expect(mocks.readDeviceSystemInfo).not.toHaveBeenCalled();
  });

  it('never routes a device-only provider to the cloud sandbox', async () => {
    const { deps } = createDeps();

    const result = await dispatchHeteroAgent(
      deps,
      createCtx({ executionTarget: 'sandbox', heterogeneousProvider: { type: 'amp' } }),
      createInput('amp'),
    );

    expect(mocks.spawnHeteroSandbox).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      deps,
      finalizeParams({
        detail:
          'No device bound. Pick a local or connected device in the Execution Device switcher.',
        message: 'No bound device for hetero agent',
      }),
    );
    expect(result).toStrictEqual(
      errorResult({ error: 'No bound device', message: 'Hetero agent requires a bound device' }),
    );
  });
});

describe('dispatchHeteroAgent — cloud sandbox', () => {
  const sandboxCtx = (env?: Record<string, string>) =>
    createCtx({
      executionTarget: 'sandbox',
      heterogeneousProvider: { env, type: 'claude-code' },
    });

  it('spawns the sandbox with the personal GitHub credential and a user JWT', async () => {
    const credsList = vi.fn().mockResolvedValue({ data: [{ id: 'cred-1', key: 'github' }] });
    const credsGet = vi.fn().mockResolvedValue({ plaintext: { access_token: 'gh-token' } });
    const marketService = { market: { creds: { get: credsGet, list: credsList } } };
    const { deps } = createDeps({ getMarketService: vi.fn().mockResolvedValue(marketService) });

    const result = await dispatchHeteroAgent(deps, sandboxCtx(), createInput('claude-code'));

    expect(credsGet).toHaveBeenCalledWith('cred-1', { decrypt: true });
    expect(mocks.signUserJWT).toHaveBeenCalledWith('user-1', '4h');
    expect(mocks.spawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'claude-code',
        githubToken: 'gh-token',
        jwt: 'user-jwt',
        marketService,
        operationId: result.operationId,
        sandbox: undefined,
      }),
    );
    expect(result).toMatchObject({ status: 'created', success: true, token: 'user-jwt' });
  });

  it('reads the GitHub credential from the workspace under a custom key', async () => {
    const credsList = vi.fn().mockResolvedValue({ data: [{ id: 'cred-2', key: 'gh-org' }] });
    const credsGet = vi.fn().mockResolvedValue({ values: { token: 'org-token' } });
    const organizationCreds = vi.fn().mockReturnValue({ get: credsGet, list: credsList });
    const marketService = { market: { organizations: { creds: organizationCreds } } };
    const { deps } = createDeps({
      getMarketService: vi.fn().mockResolvedValue(marketService),
      workspaceId: 'ws-1',
    });

    await dispatchHeteroAgent(
      deps,
      sandboxCtx({ GITHUB_CRED_KEY: 'gh-org' }),
      createInput('claude-code'),
    );

    expect(organizationCreds).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
    expect(credsGet).toHaveBeenCalledWith('cred-2', { decrypt: true });
    expect(mocks.spawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ githubToken: 'org-token', workspaceId: 'ws-1' }),
    );
  });

  it('withholds the gateway token when asked to', async () => {
    const marketService = { market: { creds: { list: vi.fn().mockResolvedValue({ data: [] }) } } };
    const { deps } = createDeps({
      getMarketService: vi.fn().mockResolvedValue(marketService),
      withholdGatewayToken: true,
    });

    const result = await dispatchHeteroAgent(deps, sandboxCtx(), createInput('claude-code'));

    expect(mocks.signUserJWT).toHaveBeenCalledTimes(1);
    expect(mocks.signUserJWT).toHaveBeenCalledWith('user-1', '4h');
    expect(result).toMatchObject({ success: true, token: undefined });
  });
});
