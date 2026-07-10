import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockConnectorQueryByIdentifiers,
  mockConnectorToolQueryAll,
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockGetAgentConfig,
  mockGetComposioManifests,
  mockGetLobehubSkillManifests,
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
  mockGetComposioManifests: vi.fn().mockResolvedValue([]),
  mockGetLobehubSkillManifests: vi.fn().mockResolvedValue([]),
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
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
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
    getLobehubSkillManifests: mockGetLobehubSkillManifests,
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: mockGetComposioManifests,
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

const pluginManifest = (identifier: string) => ({
  customParams: {},
  identifier,
  manifest: { api: [{ description: 'x', name: 'x', parameters: {} }], identifier },
});

const toolManifest = (identifier: string) => ({
  api: [{ description: 'x', name: 'x', parameters: {} }],
  identifier,
  meta: { description: 'x', title: identifier },
});

const installedPluginsArg = () =>
  mockCreateServerAgentToolsEngine.mock.calls[0][0].installedPlugins as any[];

const agentConfigPluginsArg = () =>
  mockCreateServerAgentToolsEngine.mock.calls[0][1].agentConfig.plugins as string[];

const toolManifestMapArg = () =>
  mockCreateOperation.mock.calls[0][0].toolSet.manifestMap as Record<string, unknown>;

describe('AiAgentService.execAgent - three-state plugin config (pinned/auto/disabled)', () => {
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
    mockPluginQuery.mockResolvedValue([
      pluginManifest('plugin-a'),
      pluginManifest('plugin-b'),
      pluginManifest('plugin-c'),
    ]);
    service = new AiAgentService({} as any, 'test-user-id');
  });

  it('excludes a disabled entry from the installed-plugins auto-discovery pool, in a mixed-shape array', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      // legacy string (implicit pinned) + explicit disabled object + untouched auto (plugin-c absent)
      plugins: ['plugin-a', { identifier: 'plugin-b', mode: 'disabled' }],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    const installed = installedPluginsArg().map((p) => p.identifier);
    expect(installed).toContain('plugin-a');
    expect(installed).toContain('plugin-c');
    expect(installed).not.toContain('plugin-b');
  });

  it('only feeds pinned identifiers into the engine agentConfig.plugins, excluding disabled', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [
        { identifier: 'plugin-a', mode: 'pinned' },
        { identifier: 'plugin-b', mode: 'disabled' },
      ],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(agentConfigPluginsArg()).toEqual(['plugin-a']);
  });

  it('behaves identically to a pure string array when no entry is disabled', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['plugin-a'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    const installed = installedPluginsArg().map((p) => p.identifier);
    expect(installed).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    expect(agentConfigPluginsArg()).toEqual(['plugin-a']);
  });

  it('excludes a disabled composio/lobehub-skill manifest from the activator-discovery toolManifestMap', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [
        { identifier: 'composio-disabled', mode: 'disabled' },
        { identifier: 'skill-disabled', mode: 'disabled' },
      ],
      provider: 'openai',
      systemRole: 'You are a helper',
    });
    mockGetComposioManifests.mockResolvedValue([toolManifest('composio-disabled')]);
    mockGetLobehubSkillManifests.mockResolvedValue([toolManifest('skill-disabled')]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    // The disabled entries must not resurface in the map the activator uses
    // to build <available_tools> — even though they're excluded from the
    // actual invocation pool (additionalManifests), a separate ingest loop
    // used to re-add them here from the raw (unfiltered) manifest arrays.
    expect(toolManifestMapArg()).not.toHaveProperty('composio-disabled');
    expect(toolManifestMapArg()).not.toHaveProperty('skill-disabled');
  });
});
