import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockGetAgentConfig,
  mockGetScopedOnlineDevices,
  mockGetUserSettings,
  mockMessageCreate,
  mockDispatchHeteroAgent,
  mockReserveShareVisitorTopic,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockDispatchHeteroAgent: vi.fn(),
  mockReserveShareVisitorTopic: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetScopedOnlineDevices: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockMessageCreate: vi.fn(),
}));

// The share gate runs before dispatch; record what the dispatch is handed.
vi.mock('../pipeline/heteroDispatch', () => ({ dispatchHeteroAgent: mockDispatchHeteroAgent }));

vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: mockGetScopedOnlineDevices,
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
  reserveShareVisitorTopic: mockReserveShareVisitorTopic,
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

const shareGate = (canUseDevice: boolean) => ({
  agentId: 'agent-1',
  canUseDevice,
  shareConfig: {
    deviceAccess: canUseDevice ? ('allowlist' as const) : ('none' as const),
    deviceAllowUserIds: canUseDevice ? ['visitor-1'] : [],
    toolGrants: [],
  },
  shareId: 'share-1',
  visitorUserId: 'visitor-1',
});

const agentConfig = (agencyConfig: Record<string, unknown>) => ({
  agencyConfig,
  chatConfig: {},
  id: 'agent-1',
  model: 'gpt-4',
  plugins: [],
  provider: 'openai',
  systemRole: '',
});

const run = (canUseDevice: boolean) =>
  new AiAgentService({} as any, 'creator-1').execAgent({
    agentId: 'agent-1',
    prompt: 'Hello',
    shareGate: shareGate(canUseDevice),
  });

describe('AiAgentService.execAgent - share visitors and heterogeneous agents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockReserveShareVisitorTopic.mockResolvedValue({ id: 'topic-1' });
    mockGetUserSettings.mockResolvedValue({});
    mockGetScopedOnlineDevices.mockResolvedValue([]);
    mockGetAgentConfig.mockResolvedValue(
      agentConfig({
        boundDeviceId: 'device-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
    );
  });

  it('rejects a Claude Code Agent for a visitor without the device grant', async () => {
    mockGetScopedOnlineDevices.mockResolvedValue([{ deviceId: 'device-1', online: true }]);

    await expect(run(false)).rejects.toMatchObject({
      message: 'ShareHeterogeneousAgentUnsupported',
    });
    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it.each(['openclaw', 'hermes'])(
    'rejects the remote %s runtime even with the grant',
    async (type) => {
      mockGetAgentConfig.mockResolvedValue(
        agentConfig({ boundDeviceId: 'device-1', heterogeneousProvider: { type } }),
      );
      mockGetScopedOnlineDevices.mockResolvedValue([{ deviceId: 'device-1', online: true }]);

      await expect(run(true)).rejects.toMatchObject({
        message: 'ShareHeterogeneousAgentUnsupported',
      });
      expect(mockMessageCreate).not.toHaveBeenCalled();
    },
  );

  // No cloud-sandbox fallback: a granted visitor runs on the creator's device
  // or not at all, and learns it is offline before any row is written.
  it('fails a granted visitor with a device-offline error when the device is offline', async () => {
    await expect(run(true)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'ShareHeteroDeviceUnavailable',
    });
    expect(mockGetScopedOnlineDevices).toHaveBeenCalledWith({}, 'creator-1', undefined);
    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('lets a granted visitor through when the bound device is online', async () => {
    mockGetScopedOnlineDevices.mockResolvedValue([{ deviceId: 'device-1', online: true }]);

    // The gate passes; whatever later stage this bare mock db stops at, it is
    // not one of the share gate errors.
    const error = await run(true).then(
      () => undefined,
      (e: unknown) => e as { message?: string },
    );
    expect(error?.message).not.toBe('ShareHeterogeneousAgentUnsupported');
    expect(error?.message).not.toBe('ShareHeteroDeviceUnavailable');
  });

  // Every runtime that executes on the creator's machine shares the same device
  // dispatch, so the grant covers it as it covers Claude Code / Codex.
  it.each(['opencode', 'kimi-code', 'deepseek-harness'])(
    'lets a granted visitor run the local %s runtime on the bound device',
    async (type) => {
      mockGetAgentConfig.mockResolvedValue(
        agentConfig({
          boundDeviceId: 'device-1',
          executionTarget: 'device',
          heterogeneousProvider: { type },
        }),
      );
      mockGetScopedOnlineDevices.mockResolvedValue([{ deviceId: 'device-1', online: true }]);

      const error = await run(true).then(
        () => undefined,
        (e: unknown) => e as { message?: string },
      );
      expect(error?.message).not.toBe('ShareHeterogeneousAgentUnsupported');
      expect(error?.message).not.toBe('ShareHeteroDeviceUnavailable');
    },
  );

  it('resolves an auto Agent to its only online device', async () => {
    mockGetAgentConfig.mockResolvedValue(
      agentConfig({ executionTarget: 'auto', heterogeneousProvider: { type: 'codex' } }),
    );
    mockGetScopedOnlineDevices.mockResolvedValue([{ deviceId: 'device-2', online: true }]);

    const error = await run(true).then(
      () => undefined,
      (e: unknown) => e as { message?: string },
    );
    expect(error?.message).not.toBe('ShareHeteroDeviceUnavailable');
    // The dispatch does not look at online devices, so it must be handed the
    // device the gate picked, or it reports the device as unavailable.
    expect(mockDispatchHeteroAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ requestedDeviceId: 'device-2' }),
    );
    // The automatic pick is not an explicit pin: a later turn may go to
    // whichever device is online then.
    const [, topicParams] = mockReserveShareVisitorTopic.mock.calls[0];
    expect(topicParams.metadata?.deviceBindingPinned).not.toBe(true);
    expect(topicParams.metadata?.boundDeviceId).toBeUndefined();
  });
});
