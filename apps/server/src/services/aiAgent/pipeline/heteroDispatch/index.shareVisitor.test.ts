import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecRunContext } from '../../types';
import type { HeteroDispatchDeps, HeteroDispatchInput } from '.';
import { dispatchHeteroAgent } from '.';

const mocks = vi.hoisted(() => ({
  createOperationMetadata: vi.fn(),
  dispatchAgentRun: vi.fn(),
  finalizeHeteroDispatchError: vi.fn(),
  publishAgentRuntimeInit: vi.fn(),
  recordStart: vi.fn(),
  resolveDeviceDispatchAuthorizationFailure: vi.fn(),
  resolveSandboxSessionConfig: vi.fn(),
  signHeteroOperationJWT: vi.fn(),
  signUserJWT: vi.fn(),
  spawnHeteroSandbox: vi.fn(),
}));

vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn().mockImplementation(function () {
    return {
      completeOperation: vi.fn(),
      recordStart: mocks.recordStart,
      waitForVerifyPlan: vi.fn().mockResolvedValue(undefined),
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
      planDeviceRouting: vi.fn().mockResolvedValue(null),
      resolveDeviceRowId: async (id?: string) => (id ? `row-${id}` : undefined),
    };
  }),
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    dispatchAgentRun: mocks.dispatchAgentRun,
    executeToolCall: vi.fn().mockResolvedValue({ success: true }),
    readDeviceSystemInfo: vi.fn(),
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
vi.mock('./timeoutConfirmation', () => ({ scheduleTimedOutDispatchConfirmation: vi.fn() }));
vi.mock('../codexDeviceRuntime', () => ({
  selectCodexDeviceDispatch: vi.fn().mockResolvedValue({ kind: 'exec' }),
}));

const shareGate = {
  agentId: 'agent-1',
  canUseDevice: true,
  shareConfig: { showErrorDetails: false, showModelInfo: true },
  shareId: 'share-1',
  visitorUserId: 'visitor-1',
} as any;

const createDeps = (): HeteroDispatchDeps =>
  ({
    bindTopicWorkingDirectory: vi.fn().mockResolvedValue(undefined),
    db: {} as any,
    getMarketService: vi.fn().mockRejectedValue(new Error('market unavailable')),
    messageModel: { query: vi.fn().mockResolvedValue([]) } as any,
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
    topicModel: {
      appendRunningOperationChild: vi.fn().mockResolvedValue(true),
      findById: vi.fn().mockResolvedValue({ metadata: {} }),
      patchRunningOperation: vi.fn().mockResolvedValue(true),
      settleRunningOperation: vi.fn().mockResolvedValue({ status: 'settled' }),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    } as any,
    userId: 'creator-1',
    withholdGatewayToken: false,
  }) satisfies HeteroDispatchDeps;

const createCtx = (agencyConfig: Record<string, unknown>): ExecRunContext =>
  ({
    agentConfig: { agencyConfig, id: 'agent-1', userId: 'creator-1' },
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
    shareGate,
    topicId: 'topic-1',
    userMessageId: 'user-msg-1',
  }) as ExecRunContext;

const input: HeteroDispatchInput = {
  canManageAgent: false,
  heteroType: 'claude-code',
  isPublicWorkspaceAgent: false,
  runAttachments: { audioList: [], fileList: [], imageList: [], videoList: [] },
  selfMessageIds: new Set(),
};

const deviceConfig = {
  boundDeviceId: 'dev-1',
  executionTarget: 'device',
  heterogeneousProvider: { type: 'claude-code' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordStart.mockResolvedValue(true);
  mocks.signHeteroOperationJWT.mockResolvedValue('op-jwt');
  mocks.signUserJWT.mockResolvedValue('visitor-jwt');
  mocks.finalizeHeteroDispatchError.mockResolvedValue(true);
  mocks.resolveDeviceDispatchAuthorizationFailure.mockResolvedValue(undefined);
  mocks.resolveSandboxSessionConfig.mockResolvedValue(undefined);
  mocks.dispatchAgentRun.mockResolvedValue({ success: true });
  mocks.publishAgentRuntimeInit.mockResolvedValue('init');
  mocks.createOperationMetadata.mockResolvedValue(undefined);
});

describe('dispatchHeteroAgent — share visitor run', () => {
  it('signs the gateway token for the visitor and stamps the stream owner', async () => {
    const result = await dispatchHeteroAgent(createDeps(), createCtx(deviceConfig), input);

    expect(result).toMatchObject({ success: true, token: 'visitor-jwt' });
    expect(mocks.signUserJWT).toHaveBeenCalledWith('visitor-1');
    expect(mocks.signUserJWT).not.toHaveBeenCalledWith('creator-1');

    const redaction = { showErrorDetails: false, showModelInfo: true };
    expect(mocks.createOperationMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        streamOwnerUserId: 'visitor-1',
        userId: 'creator-1',
        visitorRedaction: redaction,
      }),
    );
    expect(mocks.publishAgentRuntimeInit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ streamOwnerUserId: 'visitor-1', visitorRedaction: redaction }),
    );
  });

  it('records the visitor marker on the operation row', async () => {
    await dispatchHeteroAgent(createDeps(), createCtx(deviceConfig), input);

    expect(mocks.recordStart).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentShareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' },
        }),
      }),
    );
  });

  it('refuses to fall back to the cloud sandbox and never spawns one', async () => {
    const result = await dispatchHeteroAgent(
      createDeps(),
      createCtx({ executionTarget: 'sandbox', heterogeneousProvider: { type: 'claude-code' } }),
      input,
    );

    expect(mocks.spawnHeteroSandbox).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorType: ChatErrorType.ShareHeteroDeviceUnavailable }),
    );
    expect(result).toMatchObject({
      error: ChatErrorType.ShareHeteroDeviceUnavailable,
      success: false,
    });
  });

  // A later heteroIngest worker reads the stream owner and redaction back from
  // this metadata; without it the creator's unredacted stream would be served.
  it('does not dispatch when the stream owner metadata cannot be persisted', async () => {
    mocks.createOperationMetadata.mockRejectedValue(new Error('redis down'));

    const result = await dispatchHeteroAgent(createDeps(), createCtx(deviceConfig), input);

    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    expect(mocks.publishAgentRuntimeInit).not.toHaveBeenCalled();
    expect(mocks.finalizeHeteroDispatchError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorType: ChatErrorType.ServerAgentRuntimeError }),
    );
    expect(result).toMatchObject({ success: false });
  });
});
