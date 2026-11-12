import { ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { AiAgentService } from '../index';

const {
  mockDeviceFindByDeviceId,
  mockDeviceFindWorkspaceDeviceById,
  mockDispatchAgentRun,
  mockGetHeterogeneousResumeSessionId,
  mockMessageCreate,
  mockMessageQuery,
  mockResolveAttachmentsByFileIds,
} = vi.hoisted(() => ({
  mockDeviceFindByDeviceId: vi.fn(),
  mockDeviceFindWorkspaceDeviceById: vi.fn(),
  mockDispatchAgentRun: vi.fn().mockResolvedValue({ success: true }),
  mockGetHeterogeneousResumeSessionId: vi.fn().mockResolvedValue(undefined),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockResolveAttachmentsByFileIds: vi.fn(),
}));

// The real factory probes Redis synchronously and throws in the test env.
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createAgentStateManager: vi.fn(function () {
    return {
      createOperationMetadata: vi.fn().mockResolvedValue(undefined),
    };
  }),
  createStreamEventManager: () => ({
    publishAgentRuntimeEnd: vi.fn().mockResolvedValue('end-event-id'),
    publishAgentRuntimeInit: vi.fn().mockResolvedValue('init-event-id'),
  }),
  isRedisAvailable: vi.fn(function () {
    return false;
  }),
}));

const emptyResolvedAttachments = {
  audioList: [],
  fileList: [],
  imageList: [],
  orderedFileIds: [],
  videoList: [],
  warnings: [],
};

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../ingestAttachment', () => ({
  ingestAttachment: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

const fees = vi.hoisted(() => ({
  holdAgentRunFee: vi.fn(),
  rebindAgentRunFee: vi.fn(),
  releaseAgentRunFee: vi.fn(),
}));
const mockSignHeteroOperationJWT = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/agent-run/runFee', () => fees);

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signHeteroOperationJWT: mockSignHeteroOperationJWT,
  signUserJWT: vi.fn().mockResolvedValue('user-jwt'),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: mockMessageCreate,
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: mockMessageQuery,
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

const heteroAgentConfig = {
  agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
  chatConfig: {},
  files: [],
  id: 'agent-1',
  knowledgeBases: [],
  model: 'claude-code',
  plugins: [],
  provider: 'anthropic',
  systemRole: 'You are a helpful assistant',
};

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue(heteroAgentConfig),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findByDeviceId: mockDeviceFindByDeviceId,
      findWorkspaceDeviceById: mockDeviceFindWorkspaceDeviceById,
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue(heteroAgentConfig),
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

const topicMock = {
  appendRunningOperationChild: vi.fn().mockResolvedValue(true),
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  patchRunningOperation: vi.fn().mockResolvedValue(true),
  settleRunningOperation: vi.fn().mockResolvedValue({ status: 'settled' }),
  releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
  tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return topicMock;
  }),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
      market: {
        creds: {
          get: vi.fn(),
          list: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
    };
  }),
}));

vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(function () {
    return {
      getHeterogeneousResumeSessionId: mockGetHeterogeneousResumeSessionId,
    };
  }),
}));

vi.mock('@/server/services/heterogeneousAgent/sandboxRunner', () => ({
  spawnHeteroSandbox: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentsByFileIds: mockResolveAttachmentsByFileIds,
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return {
      parseFile: vi.fn().mockResolvedValue({ content: '' }),
    };
  }),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn().mockResolvedValue({
        autoStarted: true,
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        success: true,
      }),
      interruptOperation: vi.fn().mockResolvedValue(true),
    };
  }),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    dispatchAgentRun: mockDispatchAgentRun,
    executeToolCall: vi.fn().mockResolvedValue({ success: true }),
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/heterogeneousAgent/remoteDeviceHeteroContext', () => ({
  buildRemoteDeviceHeteroContext: vi.fn().mockReturnValue('device context'),
}));

describe('AiAgentService.execAgent - external agent run fee', () => {
  let service: AiAgentService;
  const spies: MockInstance[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    spies.push(
      vi.spyOn(AgentOperationModel.prototype, 'settleRunning').mockResolvedValue(true),
      vi.spyOn(CompletionLifecycle.prototype, 'recordStart').mockResolvedValue(true),
    );
    for (const fn of Object.values(fees)) fn.mockReset();
    mockSignHeteroOperationJWT.mockResolvedValue('op-jwt');
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageQuery.mockResolvedValue([]);
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolvedAttachments });
    mockGetHeterogeneousResumeSessionId.mockResolvedValue(undefined);
    mockDeviceFindByDeviceId.mockResolvedValue({ defaultCwd: '/Users/alice/repo' });
    mockDeviceFindWorkspaceDeviceById.mockResolvedValue(undefined);
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;

    service = new AiAgentService({} as any, 'test-user-id');
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('holds the fee and leaves it on the dispatched operation for heteroFinish to settle', async () => {
    const result = await service.execAgent({ agentId: 'agent-1', prompt: 'Fix the bug' });

    expect(result.success).toBe(true);
    expect(mockDispatchAgentRun).toHaveBeenCalled();
    const [{ holderId }] = fees.holdAgentRunFee.mock.calls[0];
    expect(fees.holdAgentRunFee).toHaveBeenCalledWith({ holderId, userId: 'test-user-id' });
    expect(fees.rebindAgentRunFee).toHaveBeenCalledWith(
      'test-user-id',
      holderId,
      result.operationId,
    );
    expect(fees.releaseAgentRunFee).not.toHaveBeenCalled();
  });

  it('leaves a refused dispatch’s fee to the completion that settles its error', async () => {
    heteroAgentConfig.agencyConfig = {
      ...heteroAgentConfig.agencyConfig,
      heterogeneousProvider: { authMode: 'api', type: 'claude-code' },
    } as any;
    const completeOperation = vi
      .spyOn(CompletionLifecycle.prototype, 'completeOperation')
      .mockResolvedValue(undefined);
    spies.push(completeOperation);

    const result = await service.execAgent({ agentId: 'agent-1', prompt: 'Fix the bug' });

    expect(result.success).toBe(false);
    expect(completeOperation.mock.calls[0].slice(0, 2)).toEqual([
      expect.objectContaining({ operationId: result.operationId }),
      'error',
    ]);
    expect(fees.rebindAgentRunFee).toHaveBeenCalled();
    expect(fees.releaseAgentRunFee).not.toHaveBeenCalled();
  });

  it('gives the fee back when the dispatch throws before the agent starts', async () => {
    mockSignHeteroOperationJWT.mockRejectedValue(new Error('jwt down'));

    await expect(service.execAgent({ agentId: 'agent-1', prompt: 'Fix the bug' })).rejects.toThrow(
      'Failed to sign operation JWT',
    );

    const [, , operationId] = fees.rebindAgentRunFee.mock.calls[0];
    expect(fees.releaseAgentRunFee).toHaveBeenCalledWith('test-user-id', operationId);
  });

  it('refuses a run the user cannot pay the fee for before writing anything', async () => {
    fees.holdAgentRunFee.mockRejectedValue(
      new TRPCError({
        code: 'PAYMENT_REQUIRED',
        message: ChatErrorType.InsufficientBudgetForAgentRunFee,
      }),
    );

    await expect(
      service.execAgent({ agentId: 'agent-1', prompt: 'Fix the bug' }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      message: ChatErrorType.InsufficientBudgetForAgentRunFee,
    });

    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    expect(fees.rebindAgentRunFee).not.toHaveBeenCalled();
    expect(fees.releaseAgentRunFee).not.toHaveBeenCalled();
  });
});
