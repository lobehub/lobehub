import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockCreateServerAgentToolsEngine, mockMessageCreate } = vi.hoisted(
  () => ({
    mockCreateOperation: vi.fn(),
    mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
      generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
      getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
    }),
    mockMessageCreate: vi.fn(),
  }),
);

const { mockDeviceProxy } = vi.hoisted(() => ({
  mockDeviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
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
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
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
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

const topicMock = {
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => topicMock),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
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

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
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
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    // Reset device proxy state
    mockDeviceProxy.isConfigured = false;
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

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

  describe('IM/Bot scenario with botContext', () => {
    it('should auto-activate when exactly one device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

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

    it('should NOT auto-activate when multiple devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);

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

    it('should NOT auto-activate when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

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
  });

  describe('IM/Bot scenario with discordContext', () => {
    it('should auto-activate when exactly one device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

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
    // regular chat used to leave activeDeviceId undefined when no
    // device was bound, which caused the local-system system prompt's
    // {{workingDirectory}} / {{hostname}} placeholders to reach the LLM as
    // literals. The model would then waste the first N steps groping for cwd.
    // Now we auto-activate when exactly one device is online — multi-device
    // users still need to bind explicitly, since picking one by recency
    // would be a guess that could route tool calls to the wrong machine.
    it('should auto-activate the only online device', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
    });

    it('should NOT auto-activate when multiple devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'List my files',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT auto-activate when no devices are online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

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
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );
      service = new AiAgentService(mockDb, userId);
    };

    it('should NOT auto-activate the single online device when executionTarget is none', async () => {
      // regression: 无设备 used to be bypassed by single-device auto-activation
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await overrideAgencyConfig({ executionTarget: 'none' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT activate a bound online device when executionTarget is none', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await overrideAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'none' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });

    it('should NOT activate any device when executionTarget is sandbox', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      await overrideAgencyConfig({ boundDeviceId: 'device-001', executionTarget: 'sandbox' });

      await service.execAgent({ agentId: 'agent-1', prompt: 'List my files' });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
    });
  });

  describe('boundDeviceId scenario', () => {
    it('should use boundDeviceId when device is online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      // Override the agent config mock to include boundDeviceId
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );

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
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );

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
    it('should prefer explicit deviceId over topic and agent bindings when online', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);
      topicMock.findById.mockResolvedValue({ metadata: { boundDeviceId: 'device-002' } });

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );

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
    // the runtime bound device. Setup: topic.metadata says device-002, but the
    // only online device is device-001. If the topic metadata were reused as
    // boundDeviceId, activeDeviceId would be undefined (device-002 is offline).
    // After auto-activate, we instead pick the most-recent online
    // device (device-001) — proving the topic's stale metadata wasn't honored.
    it('should not reuse topic boundDeviceId when no explicit deviceId is provided', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      topicMock.findById.mockResolvedValue({ metadata: { boundDeviceId: 'device-002' } });
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );

      service = new AiAgentService(mockDb, userId);

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
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice2]);

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
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

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
    // different mock shape. Topic metadata stores device-002, but only
    // device-001 is online; if topic metadata leaked into boundDeviceId,
    // activeDeviceId would be undefined (since device-002 is offline). The
    // post-auto-activate picks device-001 instead, confirming the
    // stale topic.metadata.boundDeviceId path is dead.
    it('should not reuse topic metadata bound device when no deviceId is supplied', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);
      topicMock.findById.mockResolvedValue({
        id: 'topic-1',
        metadata: { boundDeviceId: 'device-002' },
      });

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
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice2]);
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
    it('should mark autoActivated when single device is auto-activated (IM/Bot)', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );
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
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('device-001');
      // Device auto-activated → Remote Device tool should be suppressed
      expect(toolsEngineArgs.deviceContext.autoActivated).toBe(true);
    });

    it('should mark autoActivated when boundDeviceId matches an online device', async () => {
      mockDeviceProxy.isConfigured = true;
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice]);

      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );

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
      mockDeviceProxy.queryDeviceList.mockResolvedValue([onlineDevice, onlineDevice2]);

      // Restore default AgentService mock (previous test overrides with boundDeviceId)
      const { AgentService } = await import('@/server/services/agent');
      vi.mocked(AgentService).mockImplementation(
        () =>
          ({
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
          }) as any,
      );
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
      mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

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
