import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServerAgentToolsEngine } from '@/server/modules/Mecha';

import { AiAgentService } from '../../index';

// The share-gate filter now runs at the top of `discoverTools`, before
// connector resolution / stale-tool refresh — so an ungranted HTTP connector
// pinned on the creator's agent must never reach either callsite for a
// visitor turn. These spies live at hoist time so the `vi.mock` factories
// below (which run before the test body) can wire them into stubbed models.
const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockFindByIds,
  mockGetAgentConfig,
  mockGetComposioManifests,
  mockGetLobehubSkillManifests,
  mockGetUserSettings,
  mockMessageCreate,
  mockPluginQuery,
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
  mockGetComposioManifests: vi.fn().mockResolvedValue([]),
  mockGetLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  mockGetUserSettings: vi.fn(),
  mockMessageCreate: vi.fn(),
  // Installed MCP plugin rows; empty unless a test seeds one.
  mockPluginQuery: vi.fn().mockResolvedValue([]),
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
      query: mockPluginQuery,
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
    return {
      uploadFromUrl: vi.fn(),
    };
  }),
}));

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

describe('discoverTools - share gate blocks ungranted connectors early', () => {
  let service: AiAgentService;
  const mockDb = {} as any;

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
    // Pinned plugins on the creator's agent — one granted by the share, the
    // other is a connector-backed identifier that must not be resolved for a
    // visitor.
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['granted-plugin', 'ungranted-connector'],
      provider: 'openai',
      systemRole: '',
    });
    service = new AiAgentService(mockDb, 'creator-1');
  });

  it('starts an operation even when the tools engine reports no enabled tool ids', async () => {
    // `generateToolsDetailed` is not contractually obliged to return the field,
    // and the credential-snapshot read used to assume it was always an array.
    vi.mocked(createServerAgentToolsEngine).mockReturnValueOnce({
      generateToolsDetailed: vi.fn().mockReturnValue({ tools: [] }),
      getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
    } as never);

    await expect(service.execAgent({ agentId: 'agent-1', prompt: 'Hello' })).resolves.toBeDefined();
  });

  it('does not resolve or schedule refresh for a pinned connector missing from toolGrants', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      shareGate: {
        agentId: 'agent-1',
        // Only the first plugin is granted; the connector-backed one is not.
        shareConfig: { toolGrants: [{ identifier: 'granted-plugin' }] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(mockResolveByIdentifiers).toHaveBeenCalledTimes(1);
    const resolvedIdentifiers = mockResolveByIdentifiers.mock.calls[0][0] as string[];
    expect(resolvedIdentifiers).toContain('granted-plugin');
    expect(resolvedIdentifiers).not.toContain('ungranted-connector');

    // `resolveByIdentifiers` mock returns [] → `connectorsMcp` stays empty →
    // the schedule call is invoked with an empty MCP-connector list. The key
    // assertion here is that no work is scheduled against the ungranted
    // connector; asserting the array is empty proves it.
    expect(mockScheduleStaleConnectorToolsRefresh).toHaveBeenCalledTimes(1);
    const scheduledConnectors = mockScheduleStaleConnectorToolsRefresh.mock
      .calls[0][0] as unknown[];
    expect(scheduledConnectors).toEqual([]);
  });

  it('still resolves connectors that the share explicitly grants', async () => {
    // Both pinned identifiers are granted → both must reach the connector
    // resolver as normal, proving the early filter is not over-aggressive.
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      shareGate: {
        agentId: 'agent-1',
        shareConfig: {
          toolGrants: [{ identifier: 'granted-plugin' }, { identifier: 'ungranted-connector' }],
        },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(mockResolveByIdentifiers).toHaveBeenCalledTimes(1);
    const resolvedIdentifiers = mockResolveByIdentifiers.mock.calls[0][0] as string[];
    expect(resolvedIdentifiers).toEqual(
      expect.arrayContaining(['granted-plugin', 'ungranted-connector']),
    );
  });

  it('enables Agent Documents for this run only after an explicit Share grant', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Create a document',
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [{ identifier: AgentDocumentsIdentifier }] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
    expect(mockCreateServerAgentToolsEngine.mock.calls[0][1].agentConfig.plugins).toEqual([
      AgentDocumentsIdentifier,
    ]);

    vi.clearAllMocks();
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-2',
      operationId: 'op-456',
      success: true,
    });
    mockGetUserSettings.mockResolvedValue({ general: { timezone: 'UTC' } });

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Create a document',
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(mockCreateServerAgentToolsEngine.mock.calls[0][1].agentConfig.plugins).toEqual([]);
  });

  it('reads attached file types through the exact share visitor scope', async () => {
    mockFindByIds.mockResolvedValue([{ fileType: 'image/png', id: 'file-visitor' }]);

    await service.execAgent({
      agentId: 'agent-1',
      fileIds: ['file-visitor'],
      prompt: 'Describe the image',
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(mockFindByIds).toHaveBeenCalledWith(['file-visitor'], {
      shareId: 'share-1',
      type: 'agentShare',
      visitorUserId: 'visitor-1',
    });
  });

  it('holds an installed plugin the visitor was not granted out of the tool set', async () => {
    // An installed-but-unpinned plugin is discoverable by design — the share
    // gate is what keeps a visitor from reaching it (`applyShareGateToToolSet`
    // prunes the discovery map before the operation starts).
    const installedMcp = {
      identifier: 'installed-mcp',
      manifest: {
        api: [{ description: 'Ping', name: 'ping' }],
        identifier: 'installed-mcp',
        meta: {},
        type: 'mcp',
      },
      runtimeType: 'mcp',
    };
    mockPluginQuery.mockResolvedValue([installedMcp]);

    const visitorTurn = (toolGrants: { identifier: string }[]) =>
      service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
        shareGate: {
          agentId: 'agent-1',
          shareConfig: { toolGrants },
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
      });

    await visitorTurn([{ identifier: 'granted-plugin' }]);

    expect(
      mockCreateOperation.mock.calls[0][0].toolSet.manifestMap['installed-mcp'],
    ).toBeUndefined();

    // Granted → the visitor's run keeps it, so the prune above is the grant
    // check and not an accidental blanket drop.
    vi.clearAllMocks();
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-3',
      operationId: 'op-789',
      success: true,
    });
    mockGetUserSettings.mockResolvedValue({ general: { timezone: 'UTC' } });
    mockPluginQuery.mockResolvedValue([installedMcp]);

    await visitorTurn([{ identifier: 'granted-plugin' }, { identifier: 'installed-mcp' }]);

    expect(mockCreateOperation.mock.calls[0][0].toolSet.manifestMap['installed-mcp']).toBeDefined();
  });
  describe('unpinned connection sources', () => {
    const visitorTurn = (toolGrants: { identifier: string }[]) =>
      service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
        shareGate: {
          agentId: 'agent-1',
          shareConfig: { toolGrants },
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
      });
    const manifestOf = (identifier: string) => ({
      api: [{ description: 'Run', name: 'run', parameters: {} }],
      identifier,
      meta: { title: identifier },
      type: 'builtin',
    });

    it('lists LobeHub Skill tools only for granted providers', async () => {
      await visitorTurn([{ identifier: 'lobe-calculator' }, { identifier: 'linear' }]);

      expect(mockGetLobehubSkillManifests).toHaveBeenCalledWith(
        expect.objectContaining({ providerIds: ['linear'] }),
      );
    });

    it('does not ask the Market about the creator connections without an extension grant', async () => {
      await visitorTurn([{ identifier: 'lobe-calculator' }]);

      expect(mockGetLobehubSkillManifests).not.toHaveBeenCalled();
      expect(mockGetComposioManifests).not.toHaveBeenCalled();
    });

    it('reads only granted Composio connections into the activatable pool', async () => {
      mockGetComposioManifests.mockResolvedValue([manifestOf('gmail')]);

      await visitorTurn([{ identifier: 'gmail' }, { identifier: 'lobe-calculator' }]);

      expect(mockGetComposioManifests).toHaveBeenCalledWith(expect.anything(), {
        identifiers: ['gmail'],
      });
      const { manifestMap, sourceMap } = mockCreateOperation.mock.calls[0][0].toolSet;
      expect(manifestMap.gmail).toBeDefined();
      expect(sourceMap.gmail).toBe('composio');
    });

    it('does not read a granted connection the owner disabled on the Agent', async () => {
      mockGetAgentConfig.mockResolvedValue({
        chatConfig: {},
        id: 'agent-1',
        model: 'gpt-4',
        plugins: [{ identifier: 'gmail', mode: 'disabled' }],
        provider: 'openai',
        systemRole: '',
      });

      await visitorTurn([{ identifier: 'gmail' }, { identifier: 'linear' }]);

      expect(mockGetComposioManifests).toHaveBeenCalledWith(expect.anything(), {
        identifiers: ['linear'],
      });
      expect(mockGetLobehubSkillManifests).toHaveBeenCalledWith(
        expect.objectContaining({ providerIds: ['linear'] }),
      );
    });
  });
});
