import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { AiAgentService } from '../index';

const {
  mockDeviceFindByDeviceId,
  mockDeviceFindWorkspaceDeviceById,
  mockGetFullFileUrl,
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
  mockBuildRemoteDeviceHeteroContext: vi.fn().mockReturnValue('device context'),
  mockCreateOperationMetadata: vi.fn().mockResolvedValue(undefined),
  mockDeviceFindByDeviceId: vi.fn(),
  mockDeviceFindWorkspaceDeviceById: vi.fn(),
  mockGetFullFileUrl: vi.fn(async (url: string) => `https://signed.example/${url}`),
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
    return { getFullFileUrl: mockGetFullFileUrl };
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

/**
 * The user stops a run before the CLI records the prompt, then sends a
 * correction. The next turn resumes the native session, which never saw the
 * stopped prompt, so the system context must carry it.
 */
describe('AiAgentService.execAgent - hetero resume after a stopped run', () => {
  let service: AiAgentService;
  const spies: MockInstance[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    spies.push(
      vi.spyOn(AgentOperationModel.prototype, 'settleRunning').mockResolvedValue(true),
      vi.spyOn(CompletionLifecycle.prototype, 'recordStart').mockResolvedValue(true),
    );
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolvedAttachments });
    mockGetHeterogeneousResumeSessionId.mockResolvedValue('native-session-existing');
    mockBuildRemoteDeviceHeteroContext.mockReturnValue('device context');
    mockDeviceFindByDeviceId.mockResolvedValue({ defaultCwd: '/Users/alice/repo' });
    mockDeviceFindWorkspaceDeviceById.mockResolvedValue(undefined);
    mockMessageQuery.mockResolvedValue([
      { content: 'hi', id: 'old-user', role: 'user' },
      { content: 'Hi! What should we work on?', id: 'old-assistant', role: 'assistant' },
      { content: 'Clone the mobile repo into this project', id: 'stopped-user', role: 'user' },
      { content: '', id: 'stopped-assistant', role: 'assistant' },
      { content: 'Sorry, I meant into this directory', id: 'msg-1', role: 'user' },
    ]);

    service = new AiAgentService({} as any, 'test-user-id');
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('re-delivers the stopped prompt to a resumed device session', async () => {
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;

    await service.execAgent({ agentId: 'agent-1', prompt: 'Sorry, I meant into this directory' });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionId: 'native-session-existing' }),
    );
    expect(mockBuildRemoteDeviceHeteroContext).toHaveBeenNthCalledWith(1, {
      agentSystemContext: undefined,
      unansweredUserTurns: [{ content: 'Clone the mobile repo into this project', files: [] }],
    });
  });

  it('re-delivers the stopped prompt to a resumed cloud sandbox session', async () => {
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;

    await service.execAgent({ agentId: 'agent-1', prompt: 'Sorry, I meant into this directory' });

    const { resumeFallbackSystemContext, resumeSessionId, systemContext } =
      mockSpawnHeteroSandbox.mock.calls[0][0];
    expect(resumeSessionId).toBe('native-session-existing');
    expect(systemContext).toContain('<unanswered_user_messages>');
    expect(systemContext).toContain('Clone the mobile repo into this project');
    expect(systemContext).not.toContain('Hi! What should we work on?');
    expect(systemContext).not.toContain('<previous_conversation>');
    // The fresh-session fallback already carries the full history.
    expect(resumeFallbackSystemContext).toContain('Clone the mobile repo into this project');
    expect(resumeFallbackSystemContext).not.toContain('<unanswered_user_messages>');
  });

  it('re-delivers the attachments of the stopped turn with signed links', async () => {
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;
    mockMessageQuery.mockResolvedValue([
      {
        content: 'Summarize this spec',
        fileList: [
          { fileType: 'application/pdf', name: 'spec.pdf', size: 2048, url: 'files/spec.pdf' },
        ],
        id: 'stopped-user',
        role: 'user',
      },
      { content: '', id: 'stopped-assistant', role: 'assistant' },
      { content: 'Only the first section', id: 'msg-1', role: 'user' },
    ]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Only the first section' });

    expect(mockBuildRemoteDeviceHeteroContext.mock.calls[0][0].unansweredUserTurns).toEqual([
      {
        content: 'Summarize this spec',
        files: [
          {
            fileType: 'application/pdf',
            name: 'spec.pdf',
            size: 2048,
            url: 'https://signed.example/files/spec.pdf',
          },
        ],
      },
    ]);
  });

  it('adds nothing once the previous run answered', async () => {
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;
    mockMessageQuery.mockResolvedValue([
      { content: 'Clone the repo', id: 'old-user', role: 'user' },
      { content: 'Cloned.', id: 'old-assistant', role: 'assistant' },
      { content: 'Now install deps', id: 'msg-1', role: 'user' },
    ]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Now install deps' });

    expect(mockBuildRemoteDeviceHeteroContext.mock.calls[0][0].unansweredUserTurns).toBeUndefined();
  });
});
