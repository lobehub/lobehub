import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetUserSettings,
  mockMessageCreate,
  mockMessageQuery,
  mockReserveShareVisitorTurn,
  mockResolveAttachmentsByFileIds,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockReserveShareVisitorTurn: vi.fn(),
  mockResolveAttachmentsByFileIds: vi.fn(),
}));

// `discoverTools` peeks at the attached files' MIME types for media routing.
// Stub file reads so the bare mock db is never queried.
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(function () {
    return {
      findByIds: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentsByFileIds: mockResolveAttachmentsByFileIds,
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
      query: mockMessageQuery,
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

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function (_db: unknown, userId: string) {
    return {
      getUserPreference: vi.fn().mockResolvedValue({}),
      getUserSettings: () => mockGetUserSettings(userId),
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

// The historical re-activation pass asks the engine to re-enable every id
// restored from history (`isExplicitActivation`); echo them back so the share
// gate, not this stub, is what decides which ones survive.
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn(
      ({
        context,
        toolIds,
      }: {
        context?: { isExplicitActivation?: boolean };
        toolIds: string[];
      }) =>
        context?.isExplicitActivation
          ? { enabledToolIds: toolIds, tools: [] }
          : { enabledToolIds: [], tools: [] },
    ),
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

// The share path's atomic cap reservations open real DB transactions — stub
// them so execAgent can run against a bare mock db.
vi.mock('../shareVisitorAbuseGuards', () => ({
  reserveShareVisitorTopic: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  reserveShareVisitorTurn: mockReserveShareVisitorTurn,
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

describe('AiAgentService.execAgent - share-visitor historical activations', () => {
  let service: AiAgentService;
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    // An earlier turn of this topic activated one granted and one ungranted
    // tool through lobe-activator.
    mockMessageQuery.mockResolvedValue([
      { content: 'Use tools', id: 'msg-prev-user', role: 'user' },
      {
        content: 'Activated',
        id: 'msg-prev-tool',
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: {
          activatedTools: [
            { apiCount: 1, identifier: 'lobe-calculator', name: 'Calculator' },
            { apiCount: 9, identifier: 'lobe-agent-management', name: 'Agent Management' },
            { apiCount: 1, identifier: 'mcp-private', name: 'Private MCP' },
          ],
        },
        role: 'tool',
      },
    ]);
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
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });
    mockGetUserSettings.mockResolvedValue({});
    mockReserveShareVisitorTurn.mockResolvedValue({ id: 'msg-1' });
    mockResolveAttachmentsByFileIds.mockResolvedValue({
      audioList: [],
      fileList: [],
      imageList: [],
      orderedFileIds: [],
      videoList: [],
      warnings: [],
    });
    service = new AiAgentService(mockDb, 'creator-1');
  });

  it('re-activates only the historical tools this share still grants', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Calculate again',
      shareGate: {
        agentId: 'agent-1',
        shareConfig: { toolGrants: [{ identifier: 'lobe-calculator' }] },
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
    });

    expect(mockMessageQuery).toHaveBeenCalled();
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    expect(mockCreateOperation.mock.calls[0][0].toolSet.activatableToolIds).toEqual([
      'lobe-calculator',
    ]);
  });

  it('re-activates every historical tool on the creator own run', async () => {
    // Control: without a share gate the same history restores all three,
    // so the test above is measuring the gate rather than the stubs.
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Calculate again',
    });

    expect(mockCreateOperation.mock.calls[0][0].toolSet.activatableToolIds).toEqual([
      'lobe-calculator',
      'lobe-agent-management',
      'mcp-private',
    ]);
  });
});
