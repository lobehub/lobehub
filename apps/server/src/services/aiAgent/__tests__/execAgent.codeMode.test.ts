import { generateToolsFromManifest } from '@lobechat/context-engine';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CODE_MODE_IDENTIFIER } from '@/server/services/toolExecution/codeMode/constants';

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

const { mockCodeModeEnabled } = vi.hoisted(() => ({
  mockCodeModeEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/server/services/toolExecution/codeMode/featureGate', () => ({
  isMcpCodeModeEnabled: mockCodeModeEnabled,
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
    return { getAgentConfig: mockGetAgentConfig };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return { query: mockPluginQuery };
  }),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    return {
      queryByIdentifiers: mockConnectorQueryByIdentifiers,
      resolveByIdentifiers: mockConnectorQueryByIdentifiers,
    };
  }),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(function () {
    return {
      queryAllByConnectorIds: mockConnectorToolQueryAll,
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
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: vi.fn().mockResolvedValue(null),
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
    return { createOperation: mockCreateOperation };
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
    return { uploadFromUrl: vi.fn() };
  }),
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

const connector = {
  credentials: null,
  id: 'c1',
  identifier: 'github',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://mcp.example.com',
  mcpStdioConfig: null,
  name: 'GitHub',
};

const connectorTools = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    description: `tool ${i}`,
    inputSchema: { properties: { q: { type: 'string' } }, type: 'object' },
    permission: 'auto',
    toolName: `tool_${i}`,
    userConnectorId: 'c1',
  }));

/** A tools engine that enables exactly the connector manifests discovery handed it. */
const engineOverConnectorManifests = () =>
  mockCreateServerAgentToolsEngine.mockImplementation((_context: unknown, options: any) => {
    const manifests = (options.additionalManifests as any[]).filter(
      (m) => m.identifier === 'github',
    );
    return {
      generateToolsDetailed: vi.fn().mockReturnValue({
        enabledToolIds: manifests.map((m) => m.identifier),
        tools: manifests.flatMap((m) => generateToolsFromManifest(m)),
      }),
      getEnabledPluginManifests: vi
        .fn()
        .mockReturnValue(new Map(manifests.map((m) => [m.identifier, m]))),
    };
  });

const toolSetArg = () => mockCreateOperation.mock.calls[0][0].toolSet;

describe('AiAgentService.execAgent - MCP Code Mode', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCodeModeEnabled.mockResolvedValue(false);
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
      plugins: ['github'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });
    mockConnectorQueryByIdentifiers.mockResolvedValue([connector]);
    engineOverConnectorManifests();
    service = new AiAgentService({} as any, 'test-user-id');
  });

  it('offers every connector tool as its own function while the flag is off', async () => {
    mockConnectorToolQueryAll.mockResolvedValue(connectorTools(25));

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    const toolSet = toolSetArg();
    expect(toolSet.enabledToolIds).toEqual(['github']);
    expect(toolSet.tools).toHaveLength(25);
    expect(toolSet.manifestMap[CODE_MODE_IDENTIFIER]).toBeUndefined();
  });

  it('folds the connector into Code Mode when the flag is on and the run has enough tools', async () => {
    mockCodeModeEnabled.mockResolvedValue(true);
    mockConnectorToolQueryAll.mockResolvedValue(connectorTools(25));

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    const toolSet = toolSetArg();
    expect(mockCodeModeEnabled).toHaveBeenCalledWith('test-user-id');
    expect(toolSet.enabledToolIds).toEqual([CODE_MODE_IDENTIFIER]);
    expect(toolSet.tools.map((t: any) => t.function.name)).toEqual([
      `${CODE_MODE_IDENTIFIER}____docs`,
      `${CODE_MODE_IDENTIFIER}____execute`,
    ]);
    // Still resolvable, with its connection params, for the calls scripts make.
    expect(toolSet.manifestMap.github.mcpParams).toMatchObject({ url: 'https://mcp.example.com' });
    expect(toolSet.manifestMap[CODE_MODE_IDENTIFIER].codeMode.toolIds).toEqual(['github']);
  });

  it('keeps a run below the threshold unchanged even with the flag on', async () => {
    mockCodeModeEnabled.mockResolvedValue(true);
    mockConnectorToolQueryAll.mockResolvedValue(connectorTools(5));

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(toolSetArg().enabledToolIds).toEqual(['github']);
    expect(toolSetArg().tools).toHaveLength(5);
  });
});
