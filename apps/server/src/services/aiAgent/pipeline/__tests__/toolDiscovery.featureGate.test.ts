import { DashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../../index';

// Feature-flagged builtin tools must leave a server run's tool pool while
// their flag is off for the user. Same harness as the share-gate suite.
const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockFindByIds,
  mockGetAgentConfig,
  mockGetUserSettings,
  mockMessageCreate,
  mockResolveByIdentifiers,
  mockScheduleStaleConnectorToolsRefresh,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockFindByIds: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockMessageCreate: vi.fn(),
  // Returns `[]` so `connectorsMcp` stays empty — we only care about the
  // identifier list the share-gate filter allowed through to this call.
  mockResolveByIdentifiers: vi.fn().mockResolvedValue([]),
  mockScheduleStaleConnectorToolsRefresh: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(function () {
    return {
      findByIds: mockFindByIds,
    };
  }),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
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

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    return {
      queryByIdentifiers: vi.fn().mockResolvedValue([]),
      resolveByIdentifiers: mockResolveByIdentifiers,
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
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: vi.fn().mockResolvedValue(null),
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
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

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return {
      getUserPreference: vi.fn().mockResolvedValue({}),
      getUserSettings: () => mockGetUserSettings(),
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

const dashboardFlag = vi.hoisted(() => ({ value: false as boolean | string[] }));
vi.mock('@/server/featureFlags', async () => {
  const { mapFeatureFlagsEnvToState } = await import('@/config/featureFlags');
  return {
    getServerFeatureFlagsStateFromRuntimeConfig: async (userId?: string) =>
      mapFeatureFlagsEnvToState({ dashboard: dashboardFlag.value }, userId),
  };
});

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('@/server/services/connector/refresh', () => ({
  buildLastSyncedAtMap: vi.fn().mockReturnValue(new Map()),
  scheduleStaleConnectorToolsRefresh: mockScheduleStaleConnectorToolsRefresh,
}));

// The share path's atomic cap reservations open real DB transactions — stub
// them so this test can drive execAgent with a bare mock db.
vi.mock('../../shareVisitorAbuseGuards', () => ({
  reserveShareVisitorTopic: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  reserveShareVisitorTurn: vi.fn().mockResolvedValue({ id: 'msg-1' }),
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
    ],
  };
});

describe('discoverTools - feature-flagged builtin tools', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetUserSettings.mockResolvedValue({ general: { timezone: 'UTC' } });
    mockFindByIds.mockResolvedValue([]);
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      // Even a pinned lobe-dashboard must not be offered while the flag is off.
      plugins: [DashboardIdentifier],
      provider: 'openai',
      systemRole: '',
    });
    service = new AiAgentService({} as any, 'user-1');
  });

  const disabledIds = () =>
    mockCreateServerAgentToolsEngine.mock.calls[0][1].disabledPluginIds as string[];

  it('drops lobe-dashboard from the run while the dashboard flag is off', async () => {
    dashboardFlag.value = false;
    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
    expect(disabledIds()).toContain(DashboardIdentifier);
  });

  it('keeps lobe-dashboard available for a user the flag enables', async () => {
    dashboardFlag.value = ['user-1'];
    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
    expect(disabledIds()).not.toContain(DashboardIdentifier);
  });
});
