import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockConnectorQueryByIdentifiers,
  mockConnectorToolQueryAll,
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockGetAgentConfig,
  mockMessageCreate,
  mockPluginQuery,
} = vi.hoisted(() => ({
  mockConnectorQueryByIdentifiers: vi.fn().mockResolvedValue([]),
  mockConnectorToolQueryAll: vi.fn().mockResolvedValue([]),
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockGetAgentConfig: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({ decrypt: vi.fn(), encrypt: vi.fn() }),
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({ getAgentConfig: mockGetAgentConfig })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({ query: mockPluginQuery })),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    queryByIdentifiers: mockConnectorQueryByIdentifiers,
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    queryAllByConnectorIds: mockConnectorToolQueryAll,
    queryByConnector: vi.fn().mockResolvedValue([]),
    queryByConnectorIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({ createOperation: mockCreateOperation })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ uploadFromUrl: vi.fn() })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false, queryDeviceList: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      { abilities: { functionCall: true }, id: 'gpt-4', providerId: 'openai' },
    ],
  };
});

const pluginA = {
  customParams: {},
  identifier: 'plugin-a',
  manifest: { api: [{ description: 'x', name: 'x', parameters: {} }], identifier: 'plugin-a' },
} as any;

const connectorOf = (over: Record<string, unknown>) => ({
  credentials: null,
  id: 'c1',
  identifier: 'plugin-a',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  mcpStdioConfig: null,
  name: 'Plugin A connector',
  ...over,
});

const installedPluginsArg = () =>
  mockCreateServerAgentToolsEngine.mock.calls[0][0].installedPlugins as any[];

describe('AiAgentService.execAgent - connector/plugin overlap', () => {
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
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['plugin-a'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });
    mockPluginQuery.mockResolvedValue([pluginA]);
    service = new AiAgentService({} as any, 'test-user-id');
  });

  it('keeps a same-named plugin when the connector is disabled', async () => {
    mockConnectorQueryByIdentifiers.mockResolvedValue([connectorOf({ isEnabled: false })]);
    mockConnectorToolQueryAll.mockResolvedValue([
      { permission: 'auto', toolName: 'x', userConnectorId: 'c1' },
    ]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(installedPluginsArg().some((p) => p.identifier === 'plugin-a')).toBe(true);
  });

  it('keeps a same-named plugin when the connector has no synced tools', async () => {
    mockConnectorQueryByIdentifiers.mockResolvedValue([connectorOf({ isEnabled: true })]);
    mockConnectorToolQueryAll.mockResolvedValue([]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(installedPluginsArg().some((p) => p.identifier === 'plugin-a')).toBe(true);
  });

  it('replaces the plugin when the connector actually produces tools', async () => {
    mockConnectorQueryByIdentifiers.mockResolvedValue([connectorOf({ isEnabled: true })]);
    mockConnectorToolQueryAll.mockResolvedValue([
      { permission: 'auto', toolName: 'x', userConnectorId: 'c1' },
    ]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(installedPluginsArg().some((p) => p.identifier === 'plugin-a')).toBe(false);
  });
});
