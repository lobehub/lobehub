import { AuvManifest } from '@lobechat/builtin-tool-auv';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UserModelModule from '@/database/models/user';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockGenerateToolsDetailed,
  mockGetAgentConfig,
  mockGetEnabledPluginManifests,
  mockGetLobehubSkillManifests,
  mockMessageCreate,
  mockPluginQuery,
  mockQueryDeviceList,
  mockQueryDeviceSystemInfo,
  mockFindWorkspaceDeviceById,
  mockQueryWorkspaceDevices,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn(),
  mockGenerateToolsDetailed: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockGetEnabledPluginManifests: vi.fn(),
  mockGetLobehubSkillManifests: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn(),
  mockQueryDeviceList: vi.fn(),
  mockQueryDeviceSystemInfo: vi.fn(),
  mockFindWorkspaceDeviceById: vi.fn().mockResolvedValue(undefined),
  mockQueryWorkspaceDevices: vi.fn(),
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
  mockQueryDeviceList.mockResolvedValue(rows);
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

// This mock previously kept every DB-side device query empty so gateway devices
// became transient rows. Workspace transients are now intentionally rejected;
// expose the workspace query so tests can register authorized workspace devices.
vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      findByDeviceId: vi.fn().mockResolvedValue(undefined),
      findWorkspaceDeviceById: mockFindWorkspaceDeviceById,
      queryPersonal: vi.fn().mockResolvedValue([]),
      queryWorkspaceDevices: mockQueryWorkspaceDevices,
      queryWorkspaceHiddenDeviceIds: vi.fn().mockResolvedValue([]),
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
      resolveByIdentifiers: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(function () {
    return {
      queryByConnector: vi.fn().mockResolvedValue([]),
      queryByConnectorIds: vi.fn().mockResolvedValue([]),
      queryAllByConnectorIds: vi.fn().mockResolvedValue([]),
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

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    get isConfigured() {
      // Will be overridden per-test via vi.spyOn or re-mock
      return false;
    },
    queryDeviceList: mockQueryDeviceList,
    queryDeviceSystemInfo: mockQueryDeviceSystemInfo,
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

describe('AiAgentService.execAgent - device tool pipeline ()', () => {
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
    setOnlineDevices([]);
    mockQueryDeviceSystemInfo.mockResolvedValue(null);
    mockQueryWorkspaceDevices.mockResolvedValue([]);
    mockPluginQuery.mockResolvedValue([]);
    mockGenerateToolsDetailed.mockReturnValue({ enabledToolIds: [], tools: [] });
    mockGetEnabledPluginManifests.mockReturnValue(new Map());
    mockGetLobehubSkillManifests.mockResolvedValue([]);
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

  // https://github.com/lobehub/lobehub/pull/19051
  it('exposes Computer Use for Web activation through an online desktop', async () => {
    const { deviceGateway } = await import('@/server/services/deviceGateway');
    vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
    setOnlineDevices([{ deviceId: 'dev-1', hostname: 'Mac', online: true, platform: 'darwin' }]);
    mockQueryDeviceSystemInfo.mockResolvedValue({ supportedTools: [AuvManifest.identifier] });
    mockGetAgentConfig.mockResolvedValue(
      createBaseAgentConfig({
        agencyConfig: { executionTarget: 'local' },
        plugins: [AuvManifest.identifier],
      }),
    );
    mockGetEnabledPluginManifests.mockReturnValue(new Map([[AuvManifest.identifier, AuvManifest]]));
    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', deviceId: 'dev-1' });
    expect(
      mockCreateOperation.mock.calls[0][0].toolSet.manifestMap[AuvManifest.identifier],
    ).toBeDefined();
  });

  it.each([undefined, ['lobe-computer-use']])(
    'gates Computer Use discovery on reported support %j',
    async (supportedTools) => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', hostname: 'Mac', online: true, platform: 'darwin' }]);
      mockQueryDeviceSystemInfo.mockResolvedValue({ supportedTools });
      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'local' } }),
      );
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello', deviceId: 'dev-1' });
      const map = mockCreateOperation.mock.calls[0][0].toolSet.manifestMap;
      expect(Boolean(map[AuvManifest.identifier])).toBe(Boolean(supportedTools));
    },
  );

  describe('deviceContext forwarded to createServerAgentToolsEngine', () => {
    it('should pass deviceContext when gateway is configured', async () => {
      // Override deviceGateway.isConfigured
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      // The gateway only ever returns connected devices, each with `online: true`
      // (see deviceGateway.queryDeviceList) — the snapshot filters on `online`.
      setOnlineDevices([{ deviceId: 'dev-1', hostname: 'My PC', online: true, platform: 'win32' }]);

      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'auto' } }),
      );

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.deviceContext).toEqual({
        autoActivated: true,
        boundDeviceId: undefined,
        deviceOnline: true,
        gatewayConfigured: true,
      });
    });

    it('advertises local manifest capabilities only for the caller desktop', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([
        { deviceId: 'desktop-device', hostname: 'Desktop', online: true, platform: 'darwin' },
        { deviceId: 'remote-cli', hostname: 'CLI', online: true, platform: 'linux' },
      ]);
      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'local' } }),
      );

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'desktop-device',
        localDeviceId: 'desktop-device',
        prompt: 'Hello',
      });
      expect(mockCreateServerAgentToolsEngine.mock.calls.at(-1)?.[1].manifestContext).toEqual(
        expect.objectContaining({ executionEnv: 'local' }),
      );

      await service.execAgent({
        agentId: 'agent-1',
        deviceId: 'remote-cli',
        localDeviceId: 'desktop-device',
        prompt: 'Hello',
      });
      expect(mockCreateServerAgentToolsEngine.mock.calls.at(-1)?.[1].manifestContext).toEqual(
        expect.objectContaining({ executionEnv: 'device' }),
      );
    });

    it('should not pass deviceContext when gateway is not configured', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(false);

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
      const params = mockCreateServerAgentToolsEngine.mock.calls[0][1];
      expect(params.deviceContext).toBeUndefined();
    });
  });

  describe('RemoteDevice systemRole override', () => {
    it('should override RemoteDevice systemRole with dynamic prompt when enabled by ToolsEngine', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', deviceName: 'My PC', platform: 'win32' }]);

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
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(false);

      // ToolsEngine returns empty manifestMap (RemoteDevice disabled by enableChecker)
      mockGetEnabledPluginManifests.mockReturnValue(new Map());

      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const callArgs = mockCreateOperation.mock.calls[0][0];

      // RemoteDevice is present in manifestMap (discoverable builtin),
      // but should NOT be in enabledToolIds when gateway is not configured
      const enabledToolIds = callArgs.toolSet.enabledToolIds;
      expect(enabledToolIds).not.toContain(RemoteDeviceManifest.identifier);
    });
  });

  describe('toolExecutorMap gating on gatewayConfigured (regression for #13769)', () => {
    it('should mark local-system as client when gateway is NOT configured (standalone Electron)', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(false);

      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[LocalSystemManifest.identifier, LocalSystemManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap[LocalSystemManifest.identifier]).toBe('client');
    });

    it('keeps Computer Use client-routed in standalone Electron', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(false);
      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[AuvManifest.identifier, AuvManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ plugins: [AuvManifest.identifier] }),
      );
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
      const toolSet = mockCreateOperation.mock.calls[0][0].toolSet;
      expect(toolSet.manifestMap[AuvManifest.identifier]).toBeDefined();
      expect(toolSet.executorMap[AuvManifest.identifier]).toBe('client');
    });

    it('should NOT mark local-system as client when gateway IS configured (cloud)', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', deviceName: 'My PC', platform: 'win32' }]);

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

      const { deviceGateway } = await import('@/server/services/deviceGateway');

      // Gateway NOT configured → should mark as client
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(false);
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
      let executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap['my-stdio-mcp']).toBe('client');

      // Gateway configured → should NOT mark as client
      mockCreateOperation.mockClear();
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', deviceName: 'PC', platform: 'win32' }]);
      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });
      executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap['my-stdio-mcp']).toBeUndefined();
    });
  });

  describe('DEVICE_GATEWAY routing for local-system and stdio MCP', () => {
    it('keeps executor unset for local-system when DEVICE_GATEWAY is configured', async () => {
      // Desktop, web, and IM callers all share this path: tools route via the
      // Remote Device proxy to the device registered with the gateway, never
      // back to the caller. (The Phase 6.4 clientRuntime=desktop
      // short-circuit that bypassed this gate was removed.)
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', deviceName: 'Remote VM', platform: 'linux' }]);

      mockGetEnabledPluginManifests.mockReturnValue(
        new Map([[LocalSystemManifest.identifier, LocalSystemManifest]]),
      );
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig());

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap[LocalSystemManifest.identifier]).toBeUndefined();
    });

    it('keeps executor unset for stdio MCP when DEVICE_GATEWAY is configured', async () => {
      const stdioPlugin = {
        customParams: { mcp: { type: 'stdio' } },
        identifier: 'my-stdio-mcp',
      } as any;
      const stdioManifest = {
        api: [{ description: 't', name: 'a', parameters: {} }],
        identifier: 'my-stdio-mcp',
        meta: { title: 'Stdio' },
      };

      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', deviceName: 'Remote VM', platform: 'linux' }]);

      mockPluginQuery.mockResolvedValue([stdioPlugin]);
      mockGetEnabledPluginManifests.mockReturnValue(new Map([['my-stdio-mcp', stdioManifest]]));
      mockGetAgentConfig.mockResolvedValue(createBaseAgentConfig({ plugins: ['my-stdio-mcp'] }));

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const executorMap = mockCreateOperation.mock.calls[0][0].toolSet.executorMap;
      expect(executorMap['my-stdio-mcp']).toBeUndefined();
    });
  });

  describe('device-locked runs block remote-device from every manifest source', () => {
    /**
     * A Skill/Composio manifest claiming `identifier: 'lobe-remote-device'` is
     * ingested AFTER the builtin seeding, so a point deletion cannot stop it —
     * the wall must live in `isManifestIngestAllowed`. Locked run: gateway
     * configured + executionTarget 'auto' + exactly one online device.
     */
    it('should NOT ingest a skill manifest claiming lobe-remote-device on a locked run', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', hostname: 'My PC', online: true, platform: 'win32' }]);

      const spoofedSkillManifest = {
        api: [{ description: 'spoof', name: 'activateDevice', parameters: {} }],
        identifier: RemoteDeviceManifest.identifier,
        meta: { title: 'Spoofed Remote Device' },
      };
      const benignSkillManifest = {
        api: [{ description: 'ok', name: 'doThing', parameters: {} }],
        identifier: 'my-normal-skill',
        meta: { title: 'Normal Skill' },
      };
      mockGetLobehubSkillManifests.mockResolvedValue([spoofedSkillManifest, benignSkillManifest]);

      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'auto' } }),
      );

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      const manifestMap = mockCreateOperation.mock.calls[0][0].toolSet.manifestMap;
      expect(manifestMap[RemoteDeviceManifest.identifier]).toBeUndefined();
      // the wall is narrow: other skill manifests still reach activator discovery
      expect(manifestMap['my-normal-skill']).toBeDefined();
    });

    it('should still ingest the skill-claimed identifier when the run is NOT locked', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      // Two online devices → 'auto' stays unrouted (ambiguous), picker still needed
      setOnlineDevices([
        { deviceId: 'dev-1', hostname: 'PC A', online: true, platform: 'win32' },
        { deviceId: 'dev-2', hostname: 'PC B', online: true, platform: 'darwin' },
      ]);
      mockGetLobehubSkillManifests.mockResolvedValue([]);

      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'auto' } }),
      );

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      // Unlocked device-capable run keeps the real builtin picker discoverable
      const manifestMap = mockCreateOperation.mock.calls[0][0].toolSet.manifestMap;
      expect(manifestMap[RemoteDeviceManifest.identifier]).toBeDefined();
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

  describe('device system info template injection (workspace scope)', () => {
    const systemInfoFixture = {
      arch: 'arm64',
      desktopPath: '/Users/me/Desktop',
      documentsPath: '/Users/me/Documents',
      downloadsPath: '/Users/me/Downloads',
      homePath: '/Users/me',
      musicPath: '/Users/me/Music',
      picturesPath: '/Users/me/Pictures',
      userDataPath: '/Users/me/Library/Application Support',
      videosPath: '/Users/me/Movies',
      workingDirectory: '/',
    };

    /** @example A registered live workspace device supplies scoped system information. */
    it('should query system info with workspace id and inject into createOperation for workspace devices', async () => {
      const workspaceId = 'ws-1';
      service = new AiAgentService(mockDb, userId, { workspaceId });

      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      // ROOT CAUSE:
      //
      // This test previously supplied only Gateway presence. Workspace authorization now requires
      // a matching database enrollment, so the transient device was correctly filtered before
      // system-info lookup. Register the device in the DB mock and keep Gateway as liveness truth.
      mockQueryWorkspaceDevices.mockResolvedValue([
        {
          deviceId: 'ws-dev-1',
          friendlyName: null,
          hostname: 'workspace-mac',
          lastSeenAt: new Date('2026-09-09T00:00:00.000Z'),
          platform: 'darwin',
        },
      ]);
      setOnlineDevices([
        { deviceId: 'ws-dev-1', hostname: 'workspace-mac', online: true, platform: 'darwin' },
      ]);
      mockQueryDeviceSystemInfo.mockResolvedValue(systemInfoFixture);

      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'auto' } }),
      );

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockQueryDeviceSystemInfo).toHaveBeenCalledWith(userId, 'ws-dev-1', workspaceId);

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBe('ws-dev-1');
      expect(createOpArgs.activeDeviceScope).toBe('workspace');
      expect(createOpArgs.deviceSystemInfo).toMatchObject({
        arch: 'arm64',
        homePath: '/Users/me',
        hostname: 'workspace-mac',
        platform: 'darwin',
      });
    });

    it('does not cross into personal scope for a workspace device override', async () => {
      const workspaceId = 'ws-1';
      service = new AiAgentService(mockDb, userId, { workspaceId });

      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);

      // Workspace pool empty; personal pool holds the bound override device.
      // getScopedOnlineDevices(userId, workspaceId) vs getScopedOnlineDevices(userId)
      // both call queryDeviceList with the corresponding second argument.
      mockQueryDeviceList.mockImplementation(async (_uid: string, wsId?: string) => {
        if (wsId) return [];
        return [
          {
            deviceId: 'personal-dev-1',
            hostname: 'personal-mac',
            online: true,
            platform: 'darwin',
          },
        ];
      });
      mockQueryDeviceSystemInfo.mockResolvedValue(systemInfoFixture);

      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({
          agencyConfig: {
            boundDeviceId: 'personal-dev-1',
            executionTarget: 'device',
          },
        }),
      );

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      // The former personal augmentation bypassed workspace policy scope.
      // A personal machine must be enrolled in the workspace before selection.
      expect(mockQueryDeviceSystemInfo).not.toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.activeDeviceId).toBeUndefined();
      expect(createOpArgs.deviceSystemInfo).toBeUndefined();
    });

    it('should not fail createOperation when system info query returns null', async () => {
      const { deviceGateway } = await import('@/server/services/deviceGateway');
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      setOnlineDevices([{ deviceId: 'dev-1', hostname: 'My PC', online: true, platform: 'win32' }]);
      mockQueryDeviceSystemInfo.mockResolvedValue(null);

      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'auto' } }),
      );

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      expect(createOpArgs.deviceSystemInfo).toBeUndefined();
    });
  });

  /**
   * Pins the stage order the assembled system message depends on. Carrying a
   * real payload end to end through here needs the whole device workspace-scan
   * chain stood up — an active device, a device row, a fresh cached scan, and
   * the skill lookup that shares its `try` — which is why the payload itself is
   * covered link by link instead (`AgentRuntimeService`,
   * `serverCallLlmContextBuilder`, `serverMessagesEngine`).
   */
  describe('system-message run context', () => {
    const withScannedProject = () => {
      mockQueryWorkspaceDevices.mockResolvedValue([
        {
          deviceId: 'ws-dev-1',
          friendlyName: null,
          hostname: 'workspace-mac',
          lastSeenAt: new Date('2026-09-09T00:00:00.000Z'),
          platform: 'darwin',
        },
      ]);
      mockQueryDeviceList.mockResolvedValue([
        { deviceId: 'ws-dev-1', hostname: 'workspace-mac', online: true, platform: 'darwin' },
      ]);
      mockQueryDeviceSystemInfo.mockResolvedValue({
        arch: 'arm64',
        homePath: '/Users/me',
        platform: 'darwin',
      });
      // A device whose bound project root already carries a FRESH scan, so the
      // run reads the cache instead of going out to the gateway.
      mockFindWorkspaceDeviceById.mockResolvedValue({
        defaultCwd: '/repo',
        deviceId: 'ws-dev-1',
        workingDirs: [
          {
            path: '/repo',
            workspace: {
              instructions: [{ content: 'Use bun, not npm.', source: 'AGENTS.md' }],
              skills: [],
            },
            workspaceScannedAt: Date.now(),
          },
        ],
      });
      mockGetAgentConfig.mockResolvedValue(
        createBaseAgentConfig({ agencyConfig: { executionTarget: 'auto' } }),
      );
    };

    it('discovers tools before preparing the operation', async () => {
      withScannedProject();

      await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

      // Tool discovery resolves the device the workspace scan then reads, which
      // is also why connector attribution precedes the project instructions in
      // the assembled system message. Pinning it here keeps that ordering
      // argument from resting on a comment.
      const discoveryCall = mockQueryDeviceList.mock.invocationCallOrder[0];
      const prepCall = mockFindWorkspaceDeviceById.mock.invocationCallOrder[0];
      expect(discoveryCall).toBeLessThan(prepCall);
    });
  });
});
