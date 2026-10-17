import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import type * as UserModelModule from '@/database/models/user';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { AiAgentService } from '../index';

const {
  mockGetUserPreference,
  mockQueryDeviceSystemInfo,
  mockReadDeviceSystemInfo,
  mockDeviceFindByDeviceId,
  mockDeviceFindWorkspaceDeviceById,
  mockBuildRemoteDeviceHeteroContext,
  mockCreateOperationMetadata,
  mockDispatchAgentRun,
  mockExecuteToolCall,
  mockInterruptOperation,
  mockGetHeterogeneousResumeSessionId,
  mockMessageCreate,
  mockMessageQuery,
  mockMessageUpdate,
  mockResolveAttachmentsByFileIds,
  mockSpawnHeteroSandbox,
  mockIngestAttachment,
  mockPublishAgentRuntimeInit,
  mockPublishAgentRuntimeEnd,
} = vi.hoisted(() => ({
  mockGetUserPreference: vi.fn(),
  mockQueryDeviceSystemInfo: vi.fn(),
  mockReadDeviceSystemInfo: vi.fn(),
  mockBuildRemoteDeviceHeteroContext: vi.fn().mockReturnValue('device context'),
  mockCreateOperationMetadata: vi.fn().mockResolvedValue(undefined),
  mockDeviceFindByDeviceId: vi.fn(),
  mockDeviceFindWorkspaceDeviceById: vi.fn(),
  mockDispatchAgentRun: vi.fn().mockResolvedValue({ success: true }),
  mockExecuteToolCall: vi.fn().mockResolvedValue({ success: true }),
  mockInterruptOperation: vi.fn().mockResolvedValue(true),
  mockGetHeterogeneousResumeSessionId: vi.fn().mockResolvedValue(undefined),
  mockIngestAttachment: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockMessageUpdate: vi.fn().mockResolvedValue({}),
  mockPublishAgentRuntimeEnd: vi.fn().mockResolvedValue('end-event-id'),
  mockPublishAgentRuntimeInit: vi.fn().mockResolvedValue('init-event-id'),
  mockResolveAttachmentsByFileIds: vi.fn(),
  mockSpawnHeteroSandbox: vi.fn().mockResolvedValue(undefined),
}));

// Local hetero (claude-code / codebuddy / codex / cursor / opencode / pi / qoder) seeds
// publishAgentRuntimeInit so the agent-gateway DO reports `running` on a later reconnect. Stub the factory so
// the assertion below can verify the init, and so the real one (which probes
// Redis synchronously) doesn't throw a server-env error in the test env.
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createAgentStateManager: vi.fn(function () {
    return {
      createOperationMetadata: mockCreateOperationMetadata,
    };
  }),
  createStreamEventManager: () => ({
    publishAgentRuntimeEnd: mockPublishAgentRuntimeEnd,
    publishAgentRuntimeInit: mockPublishAgentRuntimeInit,
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
  ingestAttachment: mockIngestAttachment,
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signHeteroOperationJWT: vi.fn().mockResolvedValue('op-jwt'),
  signUserJWT: vi.fn().mockResolvedValue('user-jwt'),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: mockMessageCreate,
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: mockMessageQuery,
      update: mockMessageUpdate,
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

// Only the Lab preference read is replaced; the rest of UserModel stays real.
vi.mock('@/database/models/user', async (importOriginal) => {
  const actual = await importOriginal<typeof UserModelModule>();
  class UserModel extends actual.UserModel {
    getUserPreference = mockGetUserPreference;
  }
  return { ...actual, UserModel };
});

vi.mock('@/server/services/heterogeneousAgent/sandboxRunner', () => ({
  spawnHeteroSandbox: mockSpawnHeteroSandbox,
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
      interruptOperation: mockInterruptOperation,
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
    queryDeviceSystemInfo: mockQueryDeviceSystemInfo,
    readDeviceSystemInfo: mockReadDeviceSystemInfo,
    dispatchAgentRun: mockDispatchAgentRun,
    executeToolCall: mockExecuteToolCall,
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/heterogeneousAgent/remoteDeviceHeteroContext', () => ({
  buildRemoteDeviceHeteroContext: mockBuildRemoteDeviceHeteroContext,
}));

describe('AiAgentService.execAgent - Codex device runtime', () => {
  let service: AiAgentService;
  let recordStartSpy: MockInstance<CompletionLifecycle['recordStart']>;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AgentOperationModel.prototype, 'settleRunning').mockResolvedValue(true);
    recordStartSpy = vi.spyOn(CompletionLifecycle.prototype, 'recordStart').mockResolvedValue(true);
    topicMock.appendRunningOperationChild.mockResolvedValue(true);
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.patchRunningOperation.mockResolvedValue(true);
    topicMock.releaseTaskCallbackReservation.mockResolvedValue(undefined);
    topicMock.tryReserveTaskCallback.mockResolvedValue(true);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageQuery.mockResolvedValue([]);
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolvedAttachments });
    mockSpawnHeteroSandbox.mockResolvedValue(undefined);
    mockDispatchAgentRun.mockResolvedValue({ success: true });
    mockExecuteToolCall.mockResolvedValue({ success: true });
    mockGetHeterogeneousResumeSessionId.mockResolvedValue(undefined);
    mockQueryDeviceSystemInfo.mockResolvedValue(undefined);
    mockReadDeviceSystemInfo.mockResolvedValue({ ok: false, reason: 'DEVICE_OFFLINE' });
    mockGetUserPreference.mockResolvedValue(undefined);
    mockMessageQuery.mockResolvedValue([]);
    mockBuildRemoteDeviceHeteroContext.mockImplementation(function ({ conversationHistory }) {
      return conversationHistory ? 'device recovery context' : 'device context';
    });
    mockDeviceFindByDeviceId.mockResolvedValue({ defaultCwd: '/Users/alice/repo' });
    mockDeviceFindWorkspaceDeviceById.mockResolvedValue(undefined);
    mockCreateOperationMetadata.mockResolvedValue(undefined);
    mockIngestAttachment.mockReset();
    heteroAgentConfig.agencyConfig = { heterogeneousProvider: { type: 'claude-code' } } as any;
    heteroAgentConfig.model = 'claude-code';
    heteroAgentConfig.provider = 'anthropic';
    delete (heteroAgentConfig as any).userId;
    delete (heteroAgentConfig as any).visibility;
    delete (heteroAgentConfig as any).workspaceId;

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    recordStartSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ROOT CAUSE:
  // Sending a new wrapper flag to every Codex device broke installed CLIs.
  // Native mode must come from the live connection.
  /** @example An older connection still accepts an ordinary Codex prompt. */
  it('preserves ordinary Codex sends on an older connected CLI', async () => {
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    });
    mockGetUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    await service.execAgent({ agentId: 'agent-1', prompt: 'ordinary device turn' });
    /** @example No unsupported native wrapper option reaches the old process. */
    expect(mockDispatchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ args: undefined }));
    /** @example The capability is obtained from the current connection rather than stale registration. */
    expect(mockReadDeviceSystemInfo).toHaveBeenCalledWith(userId, 'device-1', undefined, {
      clientKinds: ['cli'],
    });
  });

  // ROOT CAUSE:
  // Every Codex device run switched to app-server once the CLI advertised it, so the
  // whole device population changed runtime and each dispatch paid a live capability query.
  // The app-server runtime is opt-in through the existing Labs preference.
  /** @example Without the Labs opt-in, an ordinary Codex send stays on codex exec. */
  it('keeps ordinary Codex sends on exec unless the app-server Lab is enabled', async () => {
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    });
    mockReadDeviceSystemInfo.mockResolvedValue({
      ok: true,
      systemInfo: { supportedAgentRuntimes: ['codex-app-server-v1'] },
    });
    await service.execAgent({ agentId: 'agent-1', prompt: 'ordinary device turn' });
    /** @example A capable device still receives the existing exec arguments. */
    expect(mockDispatchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ args: undefined }));
    /** @example The ordinary path does not query live device capabilities. */
    expect(mockReadDeviceSystemInfo).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  // App-server device runs dropped `conversationHistory` and the resume fallback for every
  // topic, so an ordinary topic whose native session was lost restarted with no context.
  /** @example An ordinary app-server topic keeps its transcript recovery. */
  it('keeps transcript recovery for ordinary app-server Codex topics', async () => {
    mockGetHeterogeneousResumeSessionId.mockResolvedValue('native-session-existing');
    mockGetUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    mockReadDeviceSystemInfo.mockResolvedValue({
      ok: true,
      systemInfo: { supportedAgentRuntimes: ['codex-app-server-v1'] },
    });
    mockMessageQuery.mockResolvedValue([
      { content: 'Earlier question', id: 'old-user', role: 'user' },
      { content: 'Earlier answer', id: 'old-assistant', role: 'assistant' },
      { content: 'Continue on my device', id: 'msg-1', role: 'user' },
    ]);
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Continue on my device' });

    /** @example The native runtime keeps the transcript fallback. */
    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--codex-app-server'],
        resumeFallbackSystemContext: 'device recovery context',
        resumeSessionId: 'native-session-existing',
        systemContext: 'device context',
      }),
    );
  });

  /** @example A fresh ordinary app-server topic still receives its prior turns. */
  it('injects topic history into a fresh ordinary app-server Codex run', async () => {
    mockGetUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    mockReadDeviceSystemInfo.mockResolvedValue({
      ok: true,
      systemInfo: { supportedAgentRuntimes: ['codex-app-server-v1'] },
    });
    mockMessageQuery.mockResolvedValue([
      { content: 'Create the GPU pod', id: 'old-user', role: 'user' },
      { content: 'The pod is electron-gpu-shell', id: 'old-assistant', role: 'assistant' },
      { content: 'Delete it', id: 'msg-1', role: 'user' },
    ]);
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Delete it' });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--codex-app-server'],
        resumeSessionId: undefined,
        systemContext: 'device recovery context',
      }),
    );
  });

  // ROOT CAUSE:
  // A capable Labs device always received `--codex-app-server`, even when the provider
  // carried options (e.g. `--profile`) the native handle rejects, so valid exec configs failed.
  /** @example Provider options app-server cannot honor keep the device on codex exec. */
  it('keeps Codex exec when provider arguments are unsupported by app-server', async () => {
    mockGetUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    mockReadDeviceSystemInfo.mockResolvedValue({
      ok: true,
      systemInfo: { supportedAgentRuntimes: ['codex-app-server-v1'] },
    });
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { args: ['--profile', 'work'], type: 'codex' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'ordinary device turn' });

    /** @example The exec arguments are forwarded unchanged, without the native wrapper flag. */
    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--agent-arg=--profile', '--agent-arg=work'] }),
    );
  });

  // ROOT CAUSE:
  // The capability probe preferred the Desktop connection, while the gateway routes agent
  // runs to `lh connect` first, so an older CLI beside a current Desktop got native flags.
  /** @example A current Desktop does not enable native flags for an older CLI run. */
  it('probes native Codex on the connection that receives the agent run', async () => {
    mockGetUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    // The desktop-preferring read sees the current Desktop's runtime.
    mockQueryDeviceSystemInfo.mockResolvedValue({
      supportedAgentRuntimes: ['codex-app-server-v1'],
    });
    mockReadDeviceSystemInfo.mockImplementation(async (_u, _d, _w, options) =>
      options?.clientKinds?.[0] === 'desktop'
        ? { ok: true, systemInfo: { supportedAgentRuntimes: ['codex-app-server-v1'] } }
        : { ok: true, systemInfo: {} },
    );
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'ordinary device turn' });

    /** @example The older CLI that receives the run keeps codex exec. */
    expect(mockDispatchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ args: undefined }));
  });

  /** @example A Desktop-only device runs natively, pinned to the Desktop connection. */
  it('pins a native Codex run to the client that advertised the runtime', async () => {
    mockGetUserPreference.mockResolvedValue({ lab: { enableCodexAppServer: true } });
    mockReadDeviceSystemInfo.mockImplementation(async (_u, _d, _w, options) =>
      options?.clientKinds?.[0] === 'desktop'
        ? { ok: true, systemInfo: { supportedAgentRuntimes: ['codex-app-server-v1'] } }
        : { ok: false, reason: 'NO_CAPABLE_CONNECTION' },
    );
    Object.assign(heteroAgentConfig.agencyConfig, {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'ordinary device turn' });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--codex-app-server'], clientKinds: ['desktop'] }),
    );
  });
});
