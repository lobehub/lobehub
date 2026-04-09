import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockGenerateToolsDetailed,
  mockGetAgentConfig,
  mockGetEnabledPluginManifests,
  mockMessageCreate,
  mockQueryDeviceList,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn(),
  mockGenerateToolsDetailed: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetEnabledPluginManifests: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockQueryDeviceList: vi.fn(),
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

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
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

vi.mock('@/server/modules/Mecha', () => {
  // Return the hoisted mocks so each test can configure them
  mockGenerateToolsDetailed.mockReturnValue({ enabledToolIds: [], tools: [] });
  mockGetEnabledPluginManifests.mockReturnValue(new Map());

  mockCreateServerAgentToolsEngine.mockReturnValue({
    generateToolsDetailed: mockGenerateToolsDetailed,
    getEnabledPluginManifests: mockGetEnabledPluginManifests,
  });

  return {
    createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
    serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
  };
});

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: {
    get isConfigured() {
      // Will be overridden per-test via vi.spyOn or re-mock
      return false;
    },
    queryDeviceList: mockQueryDeviceList,
    queryDeviceSystemInfo: vi.fn().mockResolvedValue(null),
  },
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

// Helper to create a base agent config
const createBaseAgentConfig = (overrides: Record<string, any> = {}) => ({
  chatConfig: {},
  id: 'agent-1',
  model: 'gpt-4',
  plugins: [],
  provider: 'openai',
  systemRole: '',
  ...overrides,
});

describe('AiAgentService.execAgent - device tool pipeline (LOBE-5636)', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockQueryDeviceList.mockResolvedValue([]);
    mockGenerateToolsDetailed.mockReturnValue({ enabledToolIds: [], tools: [] });
    mockGetEnabledPluginManifests.mockReturnValue(new Map());
    service = new AiAgentService(mockDb, userId);
  });

  describe('RemoteDevice flows through ToolsEngine pipeline', () => {
    it('should pass RemoteDevice identifier in pluginIds to ToolsEngine', async () => {
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      // Verify generateToolsDetailed receives RemoteDevice in toolIds
      expect(mockGenerateToolsDetailed).toHaveBeenCalledTimes(1);
      const toolIds = mockGenerateToolsDetailed.mock.calls[0][0].toolIds;
      expect(toolIds).toContain(RemoteDeviceManifest.identifier);
    });

    it('should pass RemoteDevice identifier in pluginIds to getEnabledPluginManifests', async () => {
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockGetEnabledPluginManifests).toHaveBeenCalledTimes(1);
      const pluginIds = mockGetEnabledPluginManifests.mock.calls[0][0];
      expect(pluginIds).toContain(RemoteDeviceManifest.identifier);
    });
  });

  describe('deviceContext forwarded to createServerAgentToolsEngine', () => {
    it('should pass deviceContext when gateway is configured', async () => {
      // Override deviceProxy.isConfigured
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'My PC', platform: 'win32' },
      ]);

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.deviceContext).toEqual({
        boundDeviceId: undefined,
        deviceOnline: true,
        gatewayConfigured: true,
      });
    });

    it('should not pass deviceContext when gateway is not configured', async () => {
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(false);

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.deviceContext).toBeUndefined();
    });
  });

  describe('RemoteDevice systemRole override', () => {
    it('should override RemoteDevice systemRole with dynamic prompt when enabled by ToolsEngine', async () => {
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'My PC', platform: 'win32' },
      ]);

      // ToolsEngine returns RemoteDevice in manifestMap (enabled by enableChecker)
      const remoteDeviceManifestFromEngine = {
        ...RemoteDeviceManifest,
        systemRole: 'original static systemRole',
      };
      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[RemoteDeviceManifest.identifier, remoteDeviceManifestFromEngine]]),
      );

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      // The toolSet.manifestMap passed to createOperation should have RemoteDevice
      // with a dynamically generated systemRole (not the static one from engine)
      const callArgs = mockCreateOperation.mock.calls[0][0];
      const manifestMap = callArgs.toolSet.manifestMap;

      expect(manifestMap[RemoteDeviceManifest.identifier]).toBeDefined();
      // generateSystemPrompt includes device info — it should NOT be the static original
      expect(manifestMap[RemoteDeviceManifest.identifier].systemRole).not.toBe(
        'original static systemRole',
      );
      // The dynamic systemRole should contain device list info
      expect(typeof manifestMap[RemoteDeviceManifest.identifier].systemRole).toBe('string');
    });

    it('should NOT have RemoteDevice in manifestMap when gateway is not configured', async () => {
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(false);

      // ToolsEngine returns empty manifestMap (RemoteDevice disabled by enableChecker)
      mockGetEnabledPluginManifests.mockReturnValue(new Map());

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const callArgs = mockCreateOperation.mock.calls[0][0];
      const manifestMap = callArgs.toolSet.manifestMap;

      // RemoteDevice should NOT be in manifestMap — no manual injection
      expect(manifestMap[RemoteDeviceManifest.identifier]).toBeUndefined();
    });
  });

  describe('toolManifestMap fully derived from ToolsEngine', () => {
    it('should derive manifestMap entirely from getEnabledPluginManifests', async () => {
      const mockManifest = {
        api: [{ description: 'test', name: 'action', parameters: {} }],
        identifier: 'test-tool',
        meta: { title: 'Test' },
      };
      mockGetEnabledPluginManifests.mockReturnValue(new Map([['test-tool', mockManifest]]));

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig({ plugins: ['test-tool'] }));

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const callArgs = mockCreateOperation.mock.calls[0][0];
      const manifestMap = callArgs.toolSet.manifestMap;

      expect(manifestMap['test-tool']).toBe(mockManifest);
      // No extra manifests added manually
      expect(Object.keys(manifestMap)).toEqual(['test-tool']);
    });
  });
});
