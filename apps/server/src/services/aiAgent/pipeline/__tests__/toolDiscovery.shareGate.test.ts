import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../../index';

// The share-gate filter now runs at the top of `discoverTools`, before
// connector resolution / stale-tool refresh — so an ungranted HTTP connector
// pinned on the creator's agent must never reach either callsite for a
// visitor turn. These spies live at hoist time so the `vi.mock` factories
// below (which run before the test body) can wire them into stubbed models.
const {
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetUserSettings,
  mockMessageCreate,
  mockResolveByIdentifiers,
  mockScheduleStaleConnectorToolsRefresh,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockMessageCreate: vi.fn(),
  // Returns `[]` so `connectorsMcp` stays empty — we only care about the
  // identifier list the share-gate filter allowed through to this call.
  mockResolveByIdentifiers: vi.fn().mockResolvedValue([]),
  mockScheduleStaleConnectorToolsRefresh: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
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
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: mockGetAgentConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(() => ({
    queryByIdentifiers: vi.fn().mockResolvedValue([]),
    resolveByIdentifiers: mockResolveByIdentifiers,
  })),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({
    queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
    queryByConnector: vi.fn().mockResolvedValue([]),
    queryByConnectorIds: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(null),
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserPreference: vi.fn().mockResolvedValue({}),
    getUserSettings: () => mockGetUserSettings(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
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
});
