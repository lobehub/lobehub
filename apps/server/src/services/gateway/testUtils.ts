/**
 * Shared fakes for the GatewayService scenario tests. Each test file keeps its
 * own `vi.mock` calls (Vitest hoists them per file) and points the factories
 * here, so every file drives the same gateway clients, models and registries.
 */
import { vi } from 'vitest';

const createGatewayClient = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  disconnectAll: vi.fn(),
  getCapabilities: vi.fn(),
  getRegisteredIds: vi.fn(),
  getStats: vi.fn(),
  getStatus: vi.fn(),
  isConfigured: false,
  isEnabled: false,
});

export const mockGatewayClient = createGatewayClient();

export const mockGatewayEnv = {
  MESSAGE_GATEWAY_ENABLED: undefined as string | undefined,
  MESSAGE_GATEWAY_SERVICE_TOKEN: 'gateway-service-token' as string | undefined,
};

// Second gateway host (Node). `configured` + `platforms` drive the mocked
// host-routing helpers below, mirroring MESSAGE_GATEWAY_NODE_URL /
// MESSAGE_GATEWAY_NODE_PLATFORMS.
export const mockNodeGatewayClient = createGatewayClient();
export const mockNodeGateway = { configured: false, platforms: [] as string[] };

export const mockGatewayManager = {
  isRunning: false,
  start: vi.fn(),
  startClient: vi.fn(),
  stop: vi.fn(),
  stopClient: vi.fn(),
};

export const mockFindEnabledByPlatform = vi.fn();
export const mockFindByAgentId = vi.fn();
export const mockFindByIds = vi.fn();
export const mockFindByPlatformAndAppId = vi.fn();
export const mockFindEnabledByPlatformAndAppId = vi.fn();
export const mockGetServerDB = vi.fn();
export const mockInitWithEnvKey = vi.fn();
export const mockUpdateBotRuntimeStatus = vi.fn();
export const mockResolveConnectionMode = vi.fn();
export const mockAssertBotFeatureAccess = vi.fn();
export const mockIsBotFeatureAccessAllowed = vi.fn();
export const mockGetBotFeatureBlockedMessage = vi.fn();
export const mockGetBotRuntimeStatus = vi.fn();
export const mockResolveMessengerInstallation = vi.fn();
export const mockFindAllLinksByPlatform = vi.fn();

// ─── Module factories (point each file's `vi.mock` here) ───

export const envsGatewayModule = () => ({ gatewayEnv: mockGatewayEnv });

export const messageGatewayClientModule = () => {
  const resolveMessageGatewayHost = (platform?: string) =>
    mockNodeGateway.configured && platform && mockNodeGateway.platforms.includes(platform)
      ? 'node'
      : 'default';
  return {
    getConfiguredMessageGatewayHosts: () =>
      mockNodeGateway.configured ? ['default', 'node'] : ['default'],
    getMessageGatewayClient: (platform?: string) =>
      resolveMessageGatewayHost(platform) === 'node' ? mockNodeGatewayClient : mockGatewayClient,
    getMessageGatewayClientForHost: (host: string) =>
      host === 'node' ? mockNodeGatewayClient : mockGatewayClient,
    // Production anchors gateway mode on the DEFAULT host: every platform not
    // routed to node falls back to it, and the node gateway cannot host those
    // platform kinds at all.
    isAnyMessageGatewayEnabled: () => mockGatewayClient.isEnabled,
    isMessageGatewayHostConfigured: (host: string) => {
      const client = host === 'node' ? mockNodeGatewayClient : mockGatewayClient;
      // Production defines isEnabled as (ENABLED === '1' && isConfigured), so
      // an enabled client is configured by construction. These fixtures set
      // the two flags independently, so mirror the real implication here
      // rather than letting a test express a state the runtime cannot reach.
      return client.isConfigured || client.isEnabled;
    },
    resolveMessageGatewayHost,
  };
};

export const messengerAccountLinkModule = () => ({
  MessengerAccountLinkModel: {
    findAllByPlatformWithCredentials: mockFindAllLinksByPlatform,
  },
});

export const gatewayManagerModule = () => ({
  createGatewayManager: () => mockGatewayManager,
  getGatewayManager: () => (mockGatewayManager.isRunning ? mockGatewayManager : null),
});

export const dbAdaptorModule = () => ({ getServerDB: mockGetServerDB });

export const agentBotProviderModule = () => ({
  AgentBotProviderModel: {
    findByAgentId: mockFindByAgentId,
    findByIds: mockFindByIds,
    findByPlatformAndAppId: mockFindByPlatformAndAppId,
    findEnabledByPlatform: mockFindEnabledByPlatform,
    findEnabledByPlatformAndAppId: mockFindEnabledByPlatformAndAppId,
  },
});

export const keyVaultsEncryptModule = () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: mockInitWithEnvKey },
});

export const runtimeStatusModule = () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    dormant: 'dormant',
    failed: 'failed',
    queued: 'queued',
    starting: 'starting',
  },
  getBotRuntimeStatus: mockGetBotRuntimeStatus,
  updateBotRuntimeStatus: mockUpdateBotRuntimeStatus,
});

export const featureAccessModule = () => ({
  assertBotFeatureAccess: mockAssertBotFeatureAccess,
  getBotFeatureBlockedMessage: mockGetBotFeatureBlockedMessage,
  isBotFeatureAccessAllowed: mockIsBotFeatureAccessAllowed,
});

export const messengerInstallationsModule = () => ({
  getInstallationStore: vi.fn(() => ({ resolveByKey: mockResolveMessengerInstallation })),
  isMessengerConnectionId: (connectionId: string) => connectionId.startsWith('messenger:'),
  messengerConnectionIdForUser: ({
    connectionMode,
    installationKey,
    userId,
  }: {
    connectionMode?: string;
    installationKey: string;
    userId: string;
  }) => {
    if (connectionMode === 'websocket' && installationKey.endsWith(':singleton')) {
      return `messenger:${installationKey.slice(0, -':singleton'.length)}:singleton`;
    }
    return `messenger:${installationKey}:user-${userId}`;
  },
});

export const messengerPlatformsModule = () => ({
  messengerPlatformRegistry: {
    getPlatform: (platform: string) => ({
      connectionMode:
        platform === 'wechat' ? 'polling' : platform === 'discord' ? 'websocket' : 'webhook',
    }),
    listPlatforms: () => [
      { connectionMode: 'websocket', id: 'discord' },
      { connectionMode: 'webhook', id: 'slack' },
      { connectionMode: 'polling', id: 'wechat' },
    ],
  },
});

export const botPlatformsModule = () => ({
  extractWatchKeywordEntries: (settings?: Record<string, unknown>) =>
    Array.isArray(settings?.watchKeywords)
      ? settings.watchKeywords.filter((e: any) => typeof e?.keyword === 'string' && e.keyword)
      : [],
  platformRegistry: {
    getPlatform: (platform: string) => ({ id: platform }),
    listPlatforms: () => [{ id: 'discord' }, { id: 'telegram' }, { id: 'wechat' }],
  },
  resolveConnectionMode: mockResolveConnectionMode,
});

/** Per-test reset: clear call history and restore every default answer. */
export const resetGatewayServiceMocks = () => {
  vi.clearAllMocks();
  mockGatewayClient.isConfigured = false;
  mockGatewayClient.isEnabled = false;
  mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = undefined;
  mockGatewayManager.isRunning = false;
  mockGetServerDB.mockResolvedValue({});
  mockInitWithEnvKey.mockResolvedValue({});
  mockFindEnabledByPlatform.mockResolvedValue([]);
  mockFindByAgentId.mockResolvedValue([]);
  mockFindByIds.mockResolvedValue([]);
  mockFindEnabledByPlatformAndAppId.mockResolvedValue(null);
  mockFindByPlatformAndAppId.mockResolvedValue(null);
  // Default: neither host describes itself. The Cloudflare gateway has no
  // capabilities endpoint at all, so "makes no claim" is the normal case and
  // must never be read as "serves nothing".
  mockGatewayClient.getCapabilities.mockResolvedValue(null);
  mockNodeGatewayClient.getCapabilities.mockResolvedValue(null);
  // Default: admin snapshot unavailable → sync falls back to per-connection
  // getStatus and skips stale-connection cleanup (matches pre-reconciliation behavior).
  mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
  mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registered-ids unavailable'));
  mockNodeGateway.configured = false;
  mockNodeGateway.platforms = [];
  mockNodeGatewayClient.isConfigured = false;
  mockNodeGatewayClient.isEnabled = false;
  mockNodeGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
  mockNodeGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
  mockFindAllLinksByPlatform.mockResolvedValue([]);
  mockUpdateBotRuntimeStatus.mockResolvedValue({});
  mockIsBotFeatureAccessAllowed.mockResolvedValue(true);
  mockGetBotFeatureBlockedMessage.mockReturnValue('This bot channel requires a paid plan.');
  mockGetBotRuntimeStatus.mockResolvedValue({});
  mockResolveMessengerInstallation.mockResolvedValue(null);
};
