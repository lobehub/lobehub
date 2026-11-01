import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockIsResourceAuthorOrAdmin,
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetPreference,
  mockMessageCreate,
  mockTopicCreate,
  mockTopicFindById,
} = vi.hoisted(() => ({
  mockIsResourceAuthorOrAdmin: vi.fn(),
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetPreference: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockTopicCreate: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  mockTopicFindById: vi.fn(),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  isResourceAuthorOrAdmin: mockIsResourceAuthorOrAdmin,
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: class {
    findById = vi.fn().mockResolvedValue(undefined);
    getGroupAgentsWithMeta = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: mockMessageCreate,
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: vi.fn().mockImplementation(function () {
    return {
      getPreference: mockGetPreference,
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn(),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: mockGetAgentConfig,
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

// Builtin agents inject their own tools, so a run under a builtin slug reaches
// connector resolution that the plain-agent cases never do.
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    return {
      queryByIdentifiers: vi.fn().mockResolvedValue([]),
      resolveByIdentifiers: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(function () {
    return {
      queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
      queryByConnector: vi.fn().mockResolvedValue([]),
      queryByConnectorIds: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
      create: mockTopicCreate,
      armScheduledRun: vi.fn().mockResolvedValue(undefined),
      findById: mockTopicFindById,
    };
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

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: mockCreateOperation,
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      uploadFromUrl: vi.fn(),
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
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'claude-sonnet-4-6',
        providerId: 'anthropic',
      },
    ],
  };
});

// A builder run is owned by the builtin builder agent; the agent it edits only rides on
// `appContext.editingAgentId`. Continuations rebuilt from the durable operation (approval /
// askUserQuestion resumes) arrive without it, which left the builder tools with no target.
describe('AiAgentService.execAgent - agent builder editing target', () => {
  let service: AiAgentService;

  const builderConfig = {
    chatConfig: {},
    id: 'agt_builder',
    model: 'gpt-4',
    plugins: [],
    provider: 'openai',
    slug: 'agent-builder',
    systemRole: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetPreference.mockResolvedValue({});
    mockIsResourceAuthorOrAdmin.mockResolvedValue(false);
    mockGetAgentConfig.mockResolvedValue({ ...builderConfig });
    mockTopicFindById.mockResolvedValue({
      agentId: 'agt_builder',
      id: 'tpc_builder',
      metadata: { editingAgentId: 'agt_target' },
    });
    service = new AiAgentService({} as any, 'test-user-id');
  });

  it('recovers the editing target from the builder topic when the run omits it', async () => {
    await service.execAgent({
      agentId: 'agt_builder',
      appContext: { scope: 'agent_builder', topicId: 'tpc_builder' },
      prompt: 'set temperature to 0.8',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    expect(mockCreateOperation.mock.calls[0][0].appContext).toMatchObject({
      agentId: 'agt_builder',
      editingAgentId: 'agt_target',
    });
  });

  it('keeps an explicit editing target over the topic record', async () => {
    await service.execAgent({
      agentId: 'agt_builder',
      appContext: {
        editingAgentId: 'agt_explicit',
        scope: 'agent_builder',
        topicId: 'tpc_builder',
      },
      prompt: 'hi',
    });

    expect(mockCreateOperation.mock.calls[0][0].appContext.editingAgentId).toBe('agt_explicit');
  });

  it('does not attach an editing target outside the agent builder scope', async () => {
    await service.execAgent({
      agentId: 'agt_builder',
      appContext: { scope: 'main', topicId: 'tpc_builder' },
      prompt: 'hi',
    });

    expect(mockCreateOperation.mock.calls[0][0].appContext.editingAgentId).toBeUndefined();
  });
});
