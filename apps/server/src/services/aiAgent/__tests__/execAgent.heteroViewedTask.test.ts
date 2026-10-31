import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import { TaskDetailService } from '@/server/services/task/detail';

import { AiAgentService } from '../index';

const {
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

describe('AiAgentService.execAgent - hetero runs see the task viewed in Tasks', () => {
  let service: AiAgentService;
  const spies: MockInstance[] = [];

  const taskAppContext = {
    defaultTaskAssigneeAgentId: 'agt_inbox',
    scope: 'task' as const,
    taskId: 'T-858',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    spies.push(
      vi.spyOn(AgentOperationModel.prototype, 'settleRunning').mockResolvedValue(true),
      vi.spyOn(CompletionLifecycle.prototype, 'recordStart').mockResolvedValue(true),
      vi.spyOn(TaskModel.prototype, 'resolve').mockResolvedValue({
        id: 'task-row-858',
      } as NonNullable<Awaited<ReturnType<TaskModel['resolve']>>>),
      vi.spyOn(TaskDetailService.prototype, 'getTaskDetail').mockResolvedValue({
        identifier: 'T-858',
        instruction: 'Make images in the task content draggable',
        name: 'Task content images cannot be dragged',
        status: 'running',
      }),
    );
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageQuery.mockResolvedValue([]);
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolvedAttachments });
    mockGetHeterogeneousResumeSessionId.mockResolvedValue(undefined);
    mockBuildRemoteDeviceHeteroContext.mockReturnValue('device context');
    mockDeviceFindByDeviceId.mockResolvedValue({ defaultCwd: '/Users/alice/repo' });
    mockDeviceFindWorkspaceDeviceById.mockResolvedValue(undefined);
    heteroAgentConfig.model = 'claude-code';
    heteroAgentConfig.provider = 'anthropic';

    service = new AiAgentService({} as any, 'test-user-id');
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it('adds the viewed task to the device run system context', async () => {
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { systemContext: 'Agent rules', type: 'claude-code' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      appContext: taskAppContext,
      prompt: 'Which issue are we working on?',
    });

    expect(TaskDetailService.prototype.getTaskDetail).toHaveBeenCalledWith('task-row-858');
    const { agentSystemContext } = mockBuildRemoteDeviceHeteroContext.mock.calls[0][0];
    expect(agentSystemContext).toMatch(/^Agent rules\n\n<page_context>/);
    expect(agentSystemContext).toContain('viewing the detail page of task T-858');
    expect(agentSystemContext).toContain('Make images in the task content draggable');
  });

  it('adds the viewed task to the cloud sandbox system context', async () => {
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      appContext: taskAppContext,
      prompt: 'Which issue are we working on?',
    });

    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        systemContext: expect.stringContaining('viewing the detail page of task T-858'),
      }),
    );
  });

  it('leaves runs outside the Tasks side conversation untouched', async () => {
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Run the task',
      taskId: 'T-858',
    });

    expect(TaskDetailService.prototype.getTaskDetail).not.toHaveBeenCalled();
    expect(mockBuildRemoteDeviceHeteroContext.mock.calls[0][0].agentSystemContext).toBeUndefined();
  });
});
