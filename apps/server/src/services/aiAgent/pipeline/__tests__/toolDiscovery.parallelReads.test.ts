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
  mockScheduleStaleConnectorToolsRefresh,
  reads,
} = vi.hoisted(() => {
  /**
   * Every independent discovery read waits on the same barrier, which only
   * opens once all of them have started. Sequential reads therefore deadlock
   * (the first one waits for a barrier the others can never reach) and this
   * test times out; overlapping reads open it and the run completes.
   *
   * The attached-file read is deliberately not part of it: `turnSetup` resolves
   * attachments before discovery begins, so it cannot share this barrier.
   */
  const STAGE_COUNT = 6;
  const started: string[] = [];
  let openBarrier: () => void = () => {};
  let barrier = new Promise<void>((resolve) => {
    openBarrier = resolve;
  });

  const gated = <T>(stage: string, value: T) =>
    vi.fn(async () => {
      started.push(stage);
      if (started.length >= STAGE_COUNT) openBarrier();
      await barrier;
      return value;
    });

  const reads = {
    agentDocuments: gated('agentDocuments', false),
    composio: gated('composio', [] as unknown[]),
    connectors: gated('connectors', [] as unknown[]),
    devices: gated('devices', [] as unknown[]),
    plugins: gated('plugins', [] as unknown[]),
    skills: gated('skills', [] as unknown[]),
    reset: () => {
      started.length = 0;
      barrier = new Promise<void>((resolve) => {
        openBarrier = resolve;
      });
    },
    started,
  };

  return {
    mockCreateOperation: vi.fn(),
    mockGetAgentConfig: vi.fn(),
    mockGetUserSettings: vi.fn(),
    mockMessageCreate: vi.fn(),
    mockScheduleStaleConnectorToolsRefresh: vi.fn(),
    reads,
  };
});

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(function () {
    return {
      findByIds: vi.fn().mockResolvedValue([]),
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
      query: reads.plugins,
    };
  }),
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn().mockImplementation(function () {
    return {
      queryByIdentifiers: vi.fn().mockResolvedValue([]),
      resolveByIdentifiers: reads.connectors,
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
      updateMetadata: vi.fn().mockResolvedValue(undefined),
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
      getLobehubSkillManifests: reads.skills,
    };
  }),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: reads.composio,
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
    isConfigured: true,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: reads.devices,
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(function () {
    return {
      hasDocuments: reads.agentDocuments,
    };
  }),
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

describe('discoverTools - independent reads run together', () => {
  let service: AiAgentService;
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    reads.reset();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetUserSettings.mockResolvedValue({ general: { timezone: 'UTC' } });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['some-plugin'],
      provider: 'openai',
      systemRole: '',
    });
    service = new AiAgentService(mockDb, 'user-1');
  });

  // This is the whole point of the wave: the send waits for the slowest read,
  // not for the sum. Each read blocks on a barrier that only opens once all of
  // them have started, so a sequential discovery cannot finish at all — the
  // first read would wait forever for stages that never start.
  it('starts every independent read before any of them resolves', async () => {
    const result = await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    expect(result.success).toBe(true);
    expect([...new Set(reads.started)].sort()).toEqual([
      'agentDocuments',
      'composio',
      'connectors',
      'devices',
      'plugins',
      'skills',
    ]);
  }, 15_000);
});
