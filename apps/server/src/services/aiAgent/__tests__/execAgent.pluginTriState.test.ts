import { onDemandBuiltinToolIds } from '@lobechat/builtin-tools';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';
import { toolSetsFrom } from './helpers/connectorToolSets';

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

// Feature-gated builtin tools (e.g. builtin-dashboard) join the disabled set
// when their flag is off; this suite covers the agent's own plugin entries,
// so run it with every gate open. Gating has its own coverage in
// pipeline/__tests__/toolDiscovery.featureGate.test.ts.
vi.mock('@/server/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getServerFeatureFlagsStateFromRuntimeConfig: vi
    .fn()
    .mockResolvedValue({ enableDashboard: true, enableWebhook: true }),
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
      resolveToolSets: toolSetsFrom(mockConnectorQueryByIdentifiers),
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
      getLobehubSkillManifests: mockGetLobehubSkillManifests,
    };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: mockGetComposioManifests,
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

const disabledPluginIdsArg = () =>
  mockCreateServerAgentToolsEngine.mock.calls[0][1].disabledPluginIds as string[];

const generateToolsArg = () =>
  mockCreateServerAgentToolsEngine.mock.results[0].value.generateToolsDetailed.mock.calls[0][0];

const toolManifestMapArg = () =>
  mockCreateOperation.mock.calls[0][0].toolSet.manifestMap as Record<string, unknown>;

describe('AiAgentService.execAgent - agent plugin entries (on / off / disabled)', () => {
  let service: AiAgentService;
  const readUserSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readUserSettings.mockResolvedValue(undefined);
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
      pluginManifest('plugin-d'),
    ]);
    service = new AiAgentService(
      { query: { userSettings: { findFirst: readUserSettings } } } as never,
      'test-user-id',
    );
  });

  it('withholds all on-demand builtins when the settings read fails', async () => {
    readUserSettings.mockRejectedValue(new Error('settings unavailable'));
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
    });
    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
    expect(disabledPluginIdsArg()).toEqual(expect.arrayContaining(onDemandBuiltinToolIds));
  });

  it('offers installed plugins except explicit opt-outs in mixed-shape configurations', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      // legacy string (implicit pinned) + explicit disabled object + explicit
      // auto object; plugin-d inherits on-demand discovery
      plugins: [
        'plugin-a',
        { identifier: 'plugin-b', mode: 'disabled' },
        { identifier: 'plugin-c', mode: 'auto' },
      ],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    const installed = installedPluginsArg().map((p) => p.identifier);
    expect(installed).toEqual(['plugin-a', 'plugin-c', 'plugin-d']);
    expect(installed).not.toContain('plugin-b');
    expect(installed).toContain('plugin-d');
    // The activator's map follows the same cut.
    expect(Object.keys(toolManifestMapArg())).toEqual(
      expect.arrayContaining(['plugin-a', 'plugin-c', 'plugin-d']),
    );
    expect(toolManifestMapArg()).not.toHaveProperty('plugin-b');
    expect(toolManifestMapArg()).toHaveProperty('plugin-d');
  });

  it('keeps pinned plugins and pinned on-demand builtins out of the engine agentConfig.plugins in Agent mode', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [
        { identifier: 'plugin-a', mode: 'pinned' },
        { identifier: 'plugin-b', mode: 'disabled' },
        { identifier: 'lobe-image-generation', mode: 'pinned' },
      ],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    // A pinned entry is on: found through the activator, not invoked up front.
    expect(agentConfigPluginsArg()).toEqual([]);
    expect(installedPluginsArg().map((p) => p.identifier)).toEqual([
      'plugin-a',
      'plugin-c',
      'plugin-d',
    ]);
    expect(toolManifestMapArg()).toHaveProperty('plugin-a');
    expect(disabledPluginIdsArg()).toContain('plugin-b');
    // Both the legacy pin and the implicit default remain discoverable.
    expect(disabledPluginIdsArg()).not.toContain('lobe-image-generation');
    expect(disabledPluginIdsArg()).not.toContain('lobe-video-generation');
  });

  it('offers a pinned media tool up front in Chat mode, which has no activator', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: { enableAgentMode: false },
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [{ identifier: 'lobe-image-generation', mode: 'pinned' }],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(agentConfigPluginsArg()).toEqual(['lobe-image-generation']);
    expect(disabledPluginIdsArg()).not.toContain('lobe-image-generation');
  });

  it('treats a legacy manual preference like Agent mode: plugins that are on stay discoverable, disabled ones stay out', async () => {
    mockGetAgentConfig.mockResolvedValue({
      // Manual mode no longer strips the activator, so on means found on demand.
      chatConfig: { skillActivateMode: 'manual' },
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [
        { identifier: 'plugin-a', mode: 'pinned' },
        { identifier: 'plugin-b', mode: 'disabled' },
        { identifier: 'plugin-c', mode: 'auto' },
      ],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(agentConfigPluginsArg()).toEqual([]);
    expect(installedPluginsArg().map((p) => p.identifier)).toEqual([
      'plugin-a',
      'plugin-c',
      'plugin-d',
    ]);
    expect(disabledPluginIdsArg()).toContain('plugin-b');
    expect(disabledPluginIdsArg()).not.toContain('plugin-a');
    expect(disabledPluginIdsArg()).not.toContain('plugin-c');
  });

  it('keeps unlisted installed plugins discoverable alongside legacy string entries', async () => {
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
    expect(installed).toEqual(['plugin-a', 'plugin-b', 'plugin-c', 'plugin-d']);
    expect(agentConfigPluginsArg()).toEqual([]);

    expect(disabledPluginIdsArg()).not.toContain('plugin-a');
    expect(disabledPluginIdsArg()).not.toContain('lobe-creds');
  });

  it('injects the mentioned plugin while other inherited plugins stay discoverable', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      selectedToolIds: ['plugin-d'],
    } as any);

    expect(installedPluginsArg().map((p) => p.identifier)).toEqual([
      'plugin-a',
      'plugin-b',
      'plugin-c',
      'plugin-d',
    ]);
    expect(agentConfigPluginsArg()).toEqual(['plugin-d']);
  });

  it('restricts an orchestration turn to the exclusive plugin set', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['plugin-a'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({
      agentId: 'agent-1',
      exclusivePluginIds: ['evidence-only'],
      prompt: 'Submit evidence',
    } as any);

    expect(agentConfigPluginsArg()).toEqual(['evidence-only']);
    expect(generateToolsArg()).toMatchObject({
      skipDefaultTools: true,
      toolIds: ['evidence-only'],
    });
  });

  it('excludes a disabled composio/lobehub-skill manifest from the activator-discovery toolManifestMap', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [
        { identifier: 'composio-disabled', mode: 'disabled' },
        { identifier: 'skill-disabled', mode: 'disabled' },
        { identifier: 'composio-on', mode: 'auto' },
        { identifier: 'skill-on', mode: 'auto' },
      ],
      provider: 'openai',
      systemRole: 'You are a helper',
    });
    mockGetComposioManifests.mockResolvedValue([
      toolManifest('composio-disabled'),
      toolManifest('composio-on'),
      toolManifest('composio-inherited'),
    ]);
    mockGetLobehubSkillManifests.mockResolvedValue([
      toolManifest('skill-disabled'),
      toolManifest('skill-on'),
      toolManifest('skill-inherited'),
    ]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    // The manifests that are on do reach the map, so the absences below are
    // the disabled entry's doing rather than an empty source.
    expect(toolManifestMapArg()).toHaveProperty('composio-on');
    expect(toolManifestMapArg()).toHaveProperty('skill-on');
    // Connections without an entry are available on demand.
    expect(toolManifestMapArg()).toHaveProperty('composio-inherited');
    expect(toolManifestMapArg()).toHaveProperty('skill-inherited');

    // The disabled entries must not resurface in the map the activator uses
    // to build <available_tools> — even though they're excluded from the
    // actual invocation pool (additionalManifests), a separate ingest loop
    // used to re-add them here from the raw (unfiltered) manifest arrays.
    expect(toolManifestMapArg()).not.toHaveProperty('composio-disabled');
    expect(toolManifestMapArg()).not.toHaveProperty('skill-disabled');
  });

  it('excludes a disabled builtin from the activator-discovery toolManifestMap', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [{ identifier: 'lobe-agent', mode: 'disabled' }],
      provider: 'openai',
      systemRole: 'You are a helper',
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' } as any);

    expect(toolManifestMapArg()).not.toHaveProperty('lobe-agent');
  });
});
