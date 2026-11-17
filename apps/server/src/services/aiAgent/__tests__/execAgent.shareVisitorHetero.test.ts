import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockGetAgentConfig, mockGetUserSettings, mockMessageCreate } =
  vi.hoisted(() => ({
    mockCreateOperation: vi.fn(),
    mockGetAgentConfig: vi.fn(),
    mockGetUserSettings: vi.fn(),
    mockMessageCreate: vi.fn(),
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

// `UserModel` here is what actually resolves `userTimezone`. Constructed with
// the userId it was called with, so the test can distinguish "read the
// creator's settings" from "read the visitor's settings" purely by which id
// the call site passed in.
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

// The share path's atomic cap reservations open real DB transactions — stub
// them so the forced-headless test below can drive execAgent with a bare mock db.
vi.mock('../shareVisitorAbuseGuards', () => ({
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

describe('AiAgentService.execAgent - share visitors and heterogeneous agents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockGetUserSettings.mockResolvedValue({});
    mockGetAgentConfig.mockResolvedValue({
      agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });
  });

  // The hetero dispatch path signs its gateway token for the run's user (the
  // creator) and registers no visitor stream owner, so a share's device grant
  // must not open it: the visitor would receive creator account access.
  it('rejects a Claude Code Agent even when the share grants device access', async () => {
    const service = new AiAgentService({} as any, 'creator-1');

    await expect(
      service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
        shareGate: {
          agentId: 'agent-1',
          canUseDevice: true,
          shareConfig: { deviceAccess: 'all', toolGrants: [] },
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
      }),
    ).rejects.toMatchObject({ message: 'ShareHeterogeneousAgentUnsupported' });

    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });
});
