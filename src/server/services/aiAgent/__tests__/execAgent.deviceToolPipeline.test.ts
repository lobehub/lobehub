import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
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
  mockPluginQuery,
  mockQueryDeviceList,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn(),
  mockGenerateToolsDetailed: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetEnabledPluginManifests: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn(),
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
    query: mockPluginQuery,
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
    mockPluginQuery.mockResolvedValue([]);
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

  describe('clientRuntime forwarded to createServerAgentToolsEngine', () => {
    it('forwards clientRuntime="desktop" so the engine enables local-system for Electron callers', async () => {
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({
        agentId: 'agent-1',
        clientRuntime: 'desktop',
        prompt: 'Hello',
      });

      expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.clientRuntime).toBe('desktop');
    });

    it('forwards clientRuntime="web" verbatim', async () => {
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({
        agentId: 'agent-1',
        clientRuntime: 'web',
        prompt: 'Hello',
      });

      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.clientRuntime).toBe('web');
    });

    it('omits clientRuntime when the caller does not specify one', async () => {
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.clientRuntime).toBeUndefined();
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

      // RemoteDevice is present in manifestMap (discoverable builtin),
      // but should NOT be in enabledToolIds when gateway is not configured
      const enabledToolIds = callArgs.toolSet.enabledToolIds;
      expect(enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });
  });

  describe('toolExecutorMap gating on gatewayConfigured (regression for #13769)', () => {
    it('should mark local-system as client when gateway is NOT configured (standalone Electron)', async () => {
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(false);

      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[LocalSystemManifest.identifier, LocalSystemManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap[LocalSystemManifest.identifier]).toBe('client');
    });

    it('should NOT mark local-system as client when gateway IS configured (cloud)', async () => {
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'My PC', platform: 'win32' },
      ]);

      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[LocalSystemManifest.identifier, LocalSystemManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap[LocalSystemManifest.identifier]).toBeUndefined();
    });

    it('should mark stdio MCP plugin as client only when gateway is NOT configured', async () => {
      const stdioPlugin = {
        customParams: { mcp: { type: 'stdio' } },
        identifier: 'my-stdio-mcp',
      } as any;
      const stdioManifest = {
        api: [{ description: 't', name: 'a', parameters: {} }],
        identifier: 'my-stdio-mcp',
        meta: { title: 'Stdio' },
      };

      mockPluginQuery.mockResolvedValue([stdioPlugin]);
      mockGetEnabledPluginManifests.mockReturnValue(new Map([['my-stdio-mcp', stdioManifest]]));
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig({ plugins: ['my-stdio-mcp'] }));

      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');

      // Gateway NOT configured → should mark as client
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(false);
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
      let executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap['my-stdio-mcp']).toBe('client');

      // Gateway configured → should NOT mark as client
      mockCreateOperation.mockClear();
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'PC', platform: 'win32' },
      ]);
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
      executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap['my-stdio-mcp']).toBeUndefined();
    });
  });

  describe('clientRuntime="desktop" bypasses the DEVICE_GATEWAY gate (Phase 6.4)', () => {
    it('marks local-system as client when caller is desktop, even with DEVICE_GATEWAY configured', async () => {
      // On cloud canary, DEVICE_GATEWAY is configured AND a remote Linux VM
      // may be registered. Before this fix, `!gatewayConfigured` was false, so
      // local-system was never stamped `executor='client'` — and dispatch fell
      // through to the Remote Device proxy (which then tried to read the file
      // on the wrong host). When clientRuntime='desktop', the caller itself is
      // the execution target and wins.
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'Remote VM', platform: 'linux' },
      ]);

      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[LocalSystemManifest.identifier, LocalSystemManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({
        agentId: 'agent-1',
        clientRuntime: 'desktop',
        prompt: 'Hello',
      });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap[LocalSystemManifest.identifier]).toBe('client');
    });

    it('marks stdio MCP as client when caller is desktop, even with DEVICE_GATEWAY configured', async () => {
      const stdioPlugin = {
        customParams: { mcp: { type: 'stdio' } },
        identifier: 'my-stdio-mcp',
      } as any;
      const stdioManifest = {
        api: [{ description: 't', name: 'a', parameters: {} }],
        identifier: 'my-stdio-mcp',
        meta: { title: 'Stdio' },
      };

      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'Remote VM', platform: 'linux' },
      ]);

      mockPluginQuery.mockResolvedValue([stdioPlugin]);
      mockGetEnabledPluginManifests.mockReturnValue(new Map([['my-stdio-mcp', stdioManifest]]));
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig({ plugins: ['my-stdio-mcp'] }));

      await service.execAgent({
        agentId: 'agent-1',
        clientRuntime: 'desktop',
        prompt: 'Hello',
      });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap['my-stdio-mcp']).toBe('client');
    });

    it('keeps legacy routing for web callers with DEVICE_GATEWAY configured', async () => {
      // Web client + DEVICE_GATEWAY configured → tools still route through
      // Remote Device proxy; executor stays unset (legacy behaviour).
      const { deviceProxy } = await import('@/server/services/toolExecution/deviceProxy');
      vi.spyOn(deviceProxy, 'isConfigured', 'get').mockReturnValue(true);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'dev-1', deviceName: 'Remote VM', platform: 'linux' },
      ]);

      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[LocalSystemManifest.identifier, LocalSystemManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({
        agentId: 'agent-1',
        clientRuntime: 'web',
        prompt: 'Hello',
      });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap[LocalSystemManifest.identifier]).toBeUndefined();
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
      // manifestMap also includes discoverable builtin tools for activator discovery
      expect(Object.keys(manifestMap)).toContain('test-tool');
    });
  });
});
