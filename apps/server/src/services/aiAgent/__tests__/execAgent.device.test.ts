import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UserModelModule from '@/database/models/user';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockMessageCreate,
  mockMessageUpdate,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockMessageCreate: vi.fn(),
  mockMessageUpdate: vi.fn(),
}));

const { mockDeviceProxy } = vi.hoisted(() => ({
  mockDeviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    queryDeviceSystemInfo: vi.fn().mockResolvedValue(undefined),
  },
}));

// Device planning tests explicitly opt into experimental pool authorization.
vi.mock('@/database/models/user', async (importOriginal) => {
  const actual = await importOriginal<typeof UserModelModule>();
  return {
    ...actual,
    UserModel: class extends actual.UserModel {
      getUserPreference = async () => ({ lab: { enableDevicePools: true } });
    },
  };
});
// Device planning tests use an explicitly allowed pool fixture, including Bot.
// Rule evaluation and registry revocation are covered by devicePool.test.ts.
const { mockAuthorizedDevices } = vi.hoisted(() => ({ mockAuthorizedDevices: vi.fn() }));
vi.mock('@/database/models/devicePool', () => ({
  DevicePoolModel: vi.fn().mockImplementation(function () {
    return { authorizedDevices: mockAuthorizedDevices };
  }),
}));

/** Builds matching online presence and registered grants for a planning fixture. */
const setOnlineDevices = (rows: Array<{ deviceId: string } & Record<string, unknown>>) => {
  mockDeviceProxy.queryDeviceList.mockResolvedValue(rows);
  mockAuthorizedDevices.mockResolvedValue([
    ...rows.map((device) => ({ device: { lastSeenAt: new Date('2026-09-12'), ...device } })),
    {
      device: {
        deviceId: 'registered-offline',
        hostname: 'offline',
        platform: 'linux',
        lastSeenAt: new Date('2026-09-12'),
      },
    },
  ]);
};

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
      update: mockMessageUpdate,
    };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        files: [],
        id: 'agent-1',
        knowledgeBases: [],
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
      }),
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

const topicMock = {
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
  tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return topicMock;
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
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: mockDeviceProxy,
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

describe('AiAgentService.execAgent - device auto-activation', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageUpdate.mockResolvedValue({});
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    // Reset device proxy state
    mockDeviceProxy.isConfigured = false;
    setOnlineDevices([]);

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const onlineDevice = {
    deviceId: 'device-001',
    hostname: 'my-laptop',
    lastSeen: '2026-03-06T12:00:00.000Z',
    online: true,
    platform: 'linux' as const,
  };

  const onlineDevice2 = {
    deviceId: 'device-002',
    hostname: 'my-desktop',
    lastSeen: '2026-03-06T12:00:00.000Z',
    online: true,
    platform: 'darwin' as const,
  };

  // Override the agent's agencyConfig and rebuild the service. Auto-activation
  // is now exclusive to `executionTarget: 'auto'` — the default (`local`) never
  // grabs a device — so the auto-activation specs opt in explicitly.
  const useAgencyConfig = async (agencyConfig: Record<string, unknown>) => {
    const { AgentService } = await import('@/server/services/agent');
    vi.mocked(AgentService).mockImplementation(function () {
      return {
        getAgentConfig: vi.fn().mockResolvedValue({
          agencyConfig,
          chatConfig: {},
          files: [],
          id: 'agent-1',
          knowledgeBases: [],
          model: 'gpt-4',
          plugins: [],
          provider: 'openai',
          systemRole: 'You are a helpful assistant',
        }),
      } as any;
    });
    service = new AiAgentService(mockDb, userId);
  };

  describe('IM/Bot scenario with botContext', () => {
    it('should auto-activate when exactly one device is online (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT auto-activate when multiple devices are online (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice, onlineDevice2]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate when no devices are online (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate the single online device by default (executionTarget unset → local)', async () => {
      // The default mode never grabs a device — only explicit `auto` does.
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({}); // unset executionTarget → default `local`

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('IM/Bot scenario with discordContext', () => {
    it('should auto-activate when exactly one device is online (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        discordContext: { channelId: 'ch-1', guildId: 'guild-1' },
        prompt: 'Check system info',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });
  });

  describe('Web UI scenario (no botContext/discordContext)', () => {
    // In `auto` mode a single online device is activated up-front, so the
    // local-system system prompt's {{workingDirectory}} / {{hostname}}
    // placeholders resolve instead of reaching the LLM as literals. Multi-device
    // users still pick explicitly (the model selects via the remote-device
    // tool). The default mode never auto-activates.
    it('should auto-activate the only online device (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT auto-activate when multiple devices are online (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice, onlineDevice2]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate when no devices are online (executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate the single online device by default (unset → local)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({}); // unset executionTarget → default `local`

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('executionTarget gating (none / sandbox never route to a device)', () => {
    const overrideAgencyConfig = async (agencyConfig: Record<string, unknown>) => {
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(function () {
        return {
          getAgentConfig: vi.fn().mockResolvedValue({
            agencyConfig,
            chatConfig: {},
            files: [],
            id: 'agent-1',
            knowledgeBases: [],
            model: 'gpt-4',
            plugins: [],
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
          }),
        } as any;
      });
      service = new AiAgentService(mockDb, userId);
    };

    it('should NOT auto-activate the single online device when executionTarget is none', async () => {
      // regression: 无设备 used to be bypassed by single-device auto-activation
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await overrideAgencyConfig({ executionTarget: 'none' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT activate a bound online device when executionTarget is none', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await overrideAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'none' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT activate any device when executionTarget is sandbox', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await overrideAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'sandbox' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('boundDeviceId scenario', () => {
    it('should use boundDeviceId when device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);

      // Override the agent config mock to include boundDeviceId
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(function () {
        return {
          getAgentConfig: vi.fn().mockResolvedValue({
            agencyConfig: { boundDeviceId: 'device-001' },
            chatConfig: {},
            files: [],
            id: 'agent-1',
            knowledgeBases: [],
            model: 'gpt-4',
            plugins: [],
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
          }),
        } as any;
      });

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT activate boundDeviceId when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(function () {
        return {
          getAgentConfig: vi.fn().mockResolvedValue({
            agencyConfig: { boundDeviceId: 'device-001' },
            chatConfig: {},
            files: [],
            id: 'agent-1',
            knowledgeBases: [],
            model: 'gpt-4',
            plugins: [],
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
          }),
        } as any;
      });

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('topic and explicit device binding', () => {
    it('uses the shared fixed device even when the request asks for another device', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice, onlineDevice2]);
      await useAgencyConfig({
        boundDeviceId: 'device-001',
        executionTargetSelectionPolicy: 'fixed',
        executionTarget: 'device',
      });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-002',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation.mock.calls[0][0].activeDeviceId).toBe('device-001');
      expect(topicMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ boundDeviceId: 'device-001' }),
        }),
        undefined,
      );
    });

    it('keeps a fixed sandbox target when the request asks for a device', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({
        executionTarget: 'sandbox',
        executionTargetSelectionPolicy: 'fixed',
      });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-001',
        prompt: 'Run a command',
      });

      expect(mockCreateOperation.mock.calls[0][0].activeDeviceId).toBeUndefined();
      expect(topicMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            boundDeviceId: undefined,
            executionConfig: {
              boundDeviceId: undefined,
              executionTarget: 'sandbox',
              inheritWorkspaceScope: true,
            },
          },
        }),
        undefined,
      );
    });

    it('fails before operation creation when the shared fixed device is offline', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice2]);
      await useAgencyConfig({
        boundDeviceId: 'device-001',
        executionTargetSelectionPolicy: 'fixed',
        executionTarget: 'device',
      });
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-1' });

      await expect(
        service.execAgent({ agentId: 'agent-1', prompt: 'Run a command' }),
      ).rejects.toMatchObject({
        cause: {
          data: {
            code: 'DEVICE_NOT_FOUND',
            deviceId: 'device-001',
            retryable: true,
            scope: 'workspace',
            workspaceId: 'workspace-1',
          },
        },
        code: 'PRECONDITION_FAILED',
      });

      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockMessageUpdate).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({
          error: expect.objectContaining({ message: 'Fixed agent device unavailable' }),
        }),
      );
    });

    it('should prefer explicit deviceId over topic and agent bindings when online', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice, onlineDevice2]);
      topicMock.findById.mockResolvedValue({ metadata: { boundDeviceId: 'device-002' } });

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(function () {
        return {
          getAgentConfig: vi.fn().mockResolvedValue({
            agencyConfig: { boundDeviceId: 'device-002' },
            chatConfig: {},
            files: [],
            id: 'agent-1',
            knowledgeBases: [],
            model: 'gpt-4',
            plugins: [],
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
          }),
        } as any;
      });

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-existing' },
        deviceId: 'device-001',
        prompt: 'Run a command',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      // updateMetadata is called for runningOperation persistence, but not for device binding
      expect(topicMock.updateMetadata).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ boundDeviceId: expect.anything() }),
      );
    });

    // Verifies topic-stored metadata.boundDeviceId is NOT silently reused as
    // the runtime bound device. Setup: `auto` mode, topic.metadata says
    // device-002, but the only online device is device-001. If the topic
    // metadata were reused as boundDeviceId, activeDeviceId would be undefined
    // (device-002 is offline). Auto-activation instead picks the single online
    // device (device-001) — proving the topic's stale metadata wasn't honored.
    it('should not reuse topic boundDeviceId when no explicit deviceId is provided', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      topicMock.findById.mockResolvedValue({ metadata: { boundDeviceId: 'device-002' } });
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-existing' },
        prompt: 'Run a command',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).not.toBe('device-002');
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should keep explicit topic binding when the bound device is offline', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice2]);

      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-001',
        prompt: 'Run a command',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
      expect(topicMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ boundDeviceId: 'device-001' }),
        }),
        undefined,
      );
    });
  });

  describe('gateway not configured', () => {
    it('should never set activeDeviceId when gateway is not configured', async () => {
      mockDeviceProxy.isConfigured = false;

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
      expect(mockDeviceProxy.queryDeviceList).not.toHaveBeenCalled();
    });
  });

  describe('topic metadata binding', () => {
    it('should include requested deviceId when creating a new topic', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'device-001',
        prompt: 'Run with device',
      });

      expect(topicMock.create).toHaveBeenCalled();
      const createArgs = topicMock.create.mock.calls[0][0];
      expect(createArgs.metadata?.boundDeviceId).toBe('device-001');
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    // Mirrors the "should not reuse topic boundDeviceId" test above with a
    // different mock shape. `auto` mode, topic metadata stores device-002, but
    // only device-001 is online; if topic metadata leaked into boundDeviceId,
    // activeDeviceId would be undefined (since device-002 is offline). The
    // auto-activation picks device-001 instead, confirming the stale
    // topic.metadata.boundDeviceId path is dead.
    it('should not reuse topic metadata bound device when no deviceId is supplied', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      topicMock.findById.mockResolvedValue({
        id: 'topic-1',
        metadata: { boundDeviceId: 'device-002' },
      });
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Use topic device',
        appContext: { topicId: 'topic-1' },
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).not.toBe('device-002');
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should not update topic metadata when a new deviceId is provided for existing topic', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice2]);
      topicMock.findById.mockResolvedValue({
        id: 'topic-1',
        metadata: { boundDeviceId: 'device-old' },
      });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Switch device',
        appContext: { topicId: 'topic-1' },
        deviceId: 'device-002',
      });

      // updateMetadata is called for runningOperation persistence, but not for device binding
      expect(topicMock.updateMetadata).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ boundDeviceId: expect.anything() }),
      );
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-002');
    });
  });

  describe('Remote Device tool injection when device is auto-activated', () => {
    it('should mark autoActivated when single device is auto-activated (IM/Bot, executionTarget: auto)', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);
      await useAgencyConfig({ executionTarget: 'auto' });

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      // Device auto-activated → Remote Device tool should be suppressed
      expect(toolsEngineArgs.deviceContext.autoActivated).toBe(true);
    });

    it('should mark autoActivated when boundDeviceId matches an online device', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(function () {
        return {
          getAgentConfig: vi.fn().mockResolvedValue({
            agencyConfig: { boundDeviceId: 'device-001' },
            chatConfig: {},
            files: [],
            id: 'agent-1',
            knowledgeBases: [],
            model: 'gpt-4',
            plugins: [],
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
          }),
        } as any;
      });

      service = new AiAgentService(mockDb, userId);
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Run a command',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(toolsEngineArgs.deviceContext.autoActivated).toBe(true);
    });

    it('should NOT mark autoActivated when multiple devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([onlineDevice, onlineDevice2]);

      // Restore default AgentService mock (previous test overrides with boundDeviceId)
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(function () {
        return {
          getAgentConfig: vi.fn().mockResolvedValue({
            chatConfig: {},
            files: [],
            id: 'agent-1',
            knowledgeBases: [],
            model: 'gpt-4',
            plugins: [],
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
          }),
        } as any;
      });
      service = new AiAgentService(mockDb, userId);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(toolsEngineArgs.deviceContext.autoActivated).toBeUndefined();
    });

    it('should NOT mark autoActivated when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      setOnlineDevices([]);

      await service.execAgent({
        agentId: 'agent-1',
        botContext: {
          applicationId: 'app-1',
          isOwner: true,
          platform: 'discord',
          platformThreadId: 'discord:guild-1:channel-1',
          senderExternalUserId: 'owner-id',
        } as any,
        prompt: 'List my files',
      });

      const toolsEngineArgs = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(toolsEngineArgs.deviceContext.autoActivated).toBeUndefined();
    });
  });
});
