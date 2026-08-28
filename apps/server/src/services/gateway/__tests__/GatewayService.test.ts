// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Import after mocks ───
import { GatewayService } from '../index';

// ─── Hoisted mocks ───

const mockGatewayClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  disconnectAll: vi.fn(),
  getCapabilities: vi.fn(),
  getRegisteredIds: vi.fn(),
  getStats: vi.fn(),
  getStatus: vi.fn(),
  isConfigured: false,
  isEnabled: false,
}));

const mockGatewayEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_ENABLED: undefined as string | undefined,
  MESSAGE_GATEWAY_SERVICE_TOKEN: 'gateway-service-token' as string | undefined,
}));

// Second gateway host (Node). `configured` + `platforms` drive the mocked
// host-routing helpers below, mirroring MESSAGE_GATEWAY_NODE_URL /
// MESSAGE_GATEWAY_NODE_PLATFORMS.
const mockNodeGatewayClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  disconnectAll: vi.fn(),
  getCapabilities: vi.fn(),
  getRegisteredIds: vi.fn(),
  getStats: vi.fn(),
  getStatus: vi.fn(),
  isConfigured: false,
  isEnabled: false,
}));
const mockNodeGateway = vi.hoisted(() => ({ configured: false, platforms: [] as string[] }));

const mockGatewayManager = vi.hoisted(() => ({
  isRunning: false,
  start: vi.fn(),
  startClient: vi.fn(),
  stop: vi.fn(),
  stopClient: vi.fn(),
}));

const mockFindEnabledByPlatform = vi.hoisted(() => vi.fn());
const mockFindByAgentId = vi.hoisted(() => vi.fn());
const mockFindByIds = vi.hoisted(() => vi.fn());
const mockFindEnabledByPlatformAndAppId = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockUpdateBotRuntimeStatus = vi.hoisted(() => vi.fn());
const mockResolveConnectionMode = vi.hoisted(() => vi.fn());
const mockIsBotFeatureAccessAllowed = vi.hoisted(() => vi.fn());
const mockGetBotFeatureBlockedMessage = vi.hoisted(() => vi.fn());
const mockGetBotRuntimeStatus = vi.hoisted(() => vi.fn());
const mockResolveMessengerInstallation = vi.hoisted(() => vi.fn());

// ─── Module mocks ───

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: mockGatewayEnv,
}));

vi.mock('../MessageGatewayClient', () => {
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
});

const mockFindAllLinksByPlatform = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: {
    findAllByPlatformWithCredentials: mockFindAllLinksByPlatform,
  },
}));

vi.mock('../GatewayManager', () => ({
  createGatewayManager: () => mockGatewayManager,
  getGatewayManager: () => (mockGatewayManager.isRunning ? mockGatewayManager : null),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: {
    findByAgentId: mockFindByAgentId,
    findByIds: mockFindByIds,
    findEnabledByPlatform: mockFindEnabledByPlatform,
    findEnabledByPlatformAndAppId: mockFindEnabledByPlatformAndAppId,
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: mockInitWithEnvKey },
}));

vi.mock('../runtimeStatus', () => ({
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
}));

vi.mock('@/business/server/bot/featureAccess', () => ({
  assertBotFeatureAccess: vi.fn(),
  getBotFeatureBlockedMessage: mockGetBotFeatureBlockedMessage,
  isBotFeatureAccessAllowed: mockIsBotFeatureAccessAllowed,
}));

vi.mock('@/server/services/messenger/installations', () => ({
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
}));

vi.mock('@/server/services/messenger/platforms', () => ({
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
}));

vi.mock('../../bot/platforms', () => ({
  extractWatchKeywordEntries: (settings?: Record<string, unknown>) =>
    Array.isArray(settings?.watchKeywords)
      ? settings.watchKeywords.filter((e: any) => typeof e?.keyword === 'string' && e.keyword)
      : [],
  platformRegistry: {
    getPlatform: (platform: string) => ({ id: platform }),
    listPlatforms: () => [{ id: 'discord' }, { id: 'telegram' }, { id: 'wechat' }],
  },
  resolveConnectionMode: mockResolveConnectionMode,
}));

describe('GatewayService', () => {
  let service: GatewayService;

  beforeEach(() => {
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
    service = new GatewayService();
  });

  // ─── useMessageGateway ───

  describe('useMessageGateway', () => {
    it('returns false when client is not enabled', () => {
      mockGatewayClient.isEnabled = false;
      expect(service.useMessageGateway).toBe(false);
    });

    it('returns true when client is enabled', () => {
      mockGatewayClient.isEnabled = true;
      expect(service.useMessageGateway).toBe(true);
    });
  });

  describe('runtime status refresh', () => {
    beforeEach(() => {
      mockGatewayClient.isEnabled = true;
      mockResolveConnectionMode.mockReturnValue('websocket');
    });

    it('preserves gateway error codes during a single refresh', async () => {
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({ id: 'prov-1', settings: {} });
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { error: 'invalid token', errorCode: 'invalid_credentials', status: 'error' },
      });

      await service.refreshBotRuntimeStatus('discord', 'app-1');

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        errorCode: 'invalid_credentials',
        errorMessage: 'invalid token',
        platform: 'discord',
        status: 'failed',
      });
    });

    it('preserves gateway error codes during an agent-wide refresh', async () => {
      mockFindByAgentId.mockResolvedValue([
        {
          applicationId: 'app-1',
          enabled: true,
          id: 'prov-1',
          platform: 'discord',
          settings: {},
        },
      ]);
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { error: 'invalid token', errorCode: 'invalid_credentials', status: 'error' },
      });

      await service.refreshBotRuntimeStatusesByAgent('agent-1');

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        errorCode: 'invalid_credentials',
        errorMessage: 'invalid token',
        platform: 'discord',
        status: 'failed',
      });
    });
  });

  // ─── ensureRunning ───

  describe('ensureRunning', () => {
    describe('in-process mode (gateway disabled)', () => {
      it('starts local GatewayManager', async () => {
        await service.ensureRunning();

        expect(mockGatewayManager.start).toHaveBeenCalled();
      });

      it('skips start if GatewayManager already running', async () => {
        mockGatewayManager.isRunning = true;

        await service.ensureRunning();

        expect(mockGatewayManager.start).not.toHaveBeenCalled();
      });
    });

    describe('gateway mode (ENABLED=1)', () => {
      beforeEach(() => {
        mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
        mockGatewayClient.isConfigured = true;
        mockGatewayClient.isEnabled = true;
      });

      it('calls syncGatewayConnections instead of starting local manager', async () => {
        await service.ensureRunning();

        expect(mockGatewayManager.start).not.toHaveBeenCalled();
      });
    });
  });

  describe('per-user messenger lifecycle', () => {
    it('registers WeChat as a real polling connection with the complete QR credential bundle', async () => {
      mockGatewayClient.isEnabled = true;
      mockResolveMessengerInstallation.mockResolvedValue({
        applicationId: 'bot@im.wechat',
        baseUrl: 'https://ilink.example.com',
        botId: 'bot@im.wechat',
        botToken: 'secret-token',
      });

      const connectionId = await service.ensureUserMessengerConnected({
        installationKey: 'wechat:alice@im.wechat',
        platform: 'wechat',
        userId: 'user-1',
      });

      expect(connectionId).toBe('messenger:wechat:alice@im.wechat:user-user-1');
      expect(mockGatewayClient.connect).toHaveBeenCalledWith({
        applicationId: 'bot@im.wechat',
        // Per-user messenger connections have no bot-provider settings row, so
        // gated capabilities always resolve to disabled.
        capabilities: { messageMonitoring: { enabled: false } },
        connectionId,
        connectionMode: 'polling',
        credentials: {
          baseUrl: 'https://ilink.example.com',
          botId: 'bot@im.wechat',
          botToken: 'secret-token',
          webhookToken: 'gateway-service-token',
        },
        platform: 'wechat',
        userId: 'user-1',
        webhookPath: '/api/agent/messenger/webhooks/wechat',
      });
    });

    it('disconnects a user WeChat poller even when active gateway flows are disabled', async () => {
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = false;

      await service.disconnectUserMessenger({
        installationKey: 'wechat:alice@im.wechat',
        platform: 'wechat',
        userId: 'user-1',
      });

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith(
        'messenger:wechat:alice@im.wechat:user-user-1',
      );
    });
  });

  // ─── syncGatewayConnections ───

  describe('syncGatewayConnections (via ensureRunning)', () => {
    beforeEach(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = true;
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
    });

    it('skips webhook-mode providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('webhook');

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('ensure-wakes a registered-only desired provider without probing status', async () => {
      // Registered-only (pruned from stats) used to be skipped outright, but a
      // stranded DO (alarm chain lost) looks exactly like this and sleeps
      // forever unless woken. The wake is an `ensure` connect, never a status
      // probe: parked connections answer 409 and keep their park.
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
    });

    it('connects disconnected providers', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-1',
          connectionId: 'prov-1',
          platform: 'discord',
        }),
        { ensure: true },
      );
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'starting' }),
      );
    });

    it('persists a dormant ensure result as dormant, not starting', async () => {
      // An `ensure` reconcile of a sparse-polling DO can legitimately return
      // `dormant`; it must be mapped through the shared helper so it is not
      // collapsed to `starting` (the DO sends no correcting callback).
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockResolvedValue({ status: 'dormant' });

      await service.ensureRunning();

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'dormant' }),
      );
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'starting' }),
      );
    });

    it('disconnects paid-only WeChat providers when the owner is on a free plan', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db, platform) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'free-user',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockIsBotFeatureAccessAllowed.mockResolvedValue(false);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });

      await service.ensureRunning();

      expect(mockIsBotFeatureAccessAllowed).toHaveBeenCalledWith({
        applicationId: 'wechat-app',
        platform: 'wechat',
        userId: 'free-user',
        workspaceId: undefined,
      });
      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('wechat-provider');
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'wechat-app',
          errorMessage: 'This bot channel requires a paid plan.',
          platform: 'wechat',
          status: 'failed',
        }),
      );
    });

    it.each([
      { snapshot: 'stats-only', statsUnavailable: false },
      { snapshot: 'unavailable', statsUnavailable: true },
    ])(
      'disconnects a paid-gated provider when the registry snapshot is $snapshot',
      async ({ statsUnavailable }) => {
        mockFindEnabledByPlatform.mockImplementation(async (_db, platform) =>
          platform === 'wechat'
            ? [
                {
                  applicationId: 'wechat-app',
                  credentials: { botToken: 'token' },
                  id: 'wechat-provider',
                  settings: {},
                  userId: 'free-user',
                },
              ]
            : [],
        );
        mockResolveConnectionMode.mockReturnValue('polling');
        mockIsBotFeatureAccessAllowed.mockResolvedValue(false);
        mockGatewayClient.getRegisteredIds.mockRejectedValue(
          new Error('registered-ids unavailable'),
        );
        if (statsUnavailable) {
          mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
        }

        await service.ensureRunning();

        expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('wechat-provider');
        expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
        expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      },
    );

    it('sets connected status for sync connect result', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockResolvedValue({ status: 'connected' });

      await service.ensureRunning();

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected' }),
      );
    });

    it('defers desired providers when the gateway snapshot is unavailable', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registered-ids unavailable'));

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('handles connect failure gracefully', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockRejectedValue(new Error('timeout'));

      // Should not throw
      await expect(service.ensureRunning()).resolves.toBeUndefined();
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
    });

    it('keeps the connection when the feature gate check itself throws', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockIsBotFeatureAccessAllowed.mockRejectedValue(new Error('subscription service down'));
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });

      await service.ensureRunning();

      // Fail-open: no disconnect, provider stays in the desired set. As a
      // desired registered-only id it may receive the idempotent ensure wake,
      // which preserves whatever state the gateway holds.
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalledWith(expect.anything(), {
        ensure: false,
      });
    });

    it('does not repeatedly disconnect a gated provider absent from the gateway snapshot', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db, platform) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'free-user',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockIsBotFeatureAccessAllowed.mockResolvedValue(false);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'wechat-app',
          status: 'failed',
        }),
      );
    });
  });

  describe('syncGatewayConnections reconciliation (via ensureRunning)', () => {
    const provider = {
      applicationId: 'app-1',
      credentials: { token: 'x' },
      id: 'prov-1',
      settings: {},
      userId: 'u1',
    };

    beforeEach(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = true;
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
    });

    it('disconnects gateway connections with no matching enabled provider', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
          {
            connectionId: 'stale-1',
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'gone',
          },
        ],
        total: 2,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('stale-1');
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalledWith('prov-1');
      // Desired + connected → no reconnect either.
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('never disconnects messenger-owned connections', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'messenger:discord:singleton',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'system',
          },
          {
            connectionId: 'messenger:telegram:user-u1',
            platform: 'telegram',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 2,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('includes registered-only ids (pruned from stats) in stale-connection cleanup', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['dormant-stale'] });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('dormant-stale');
    });

    it('marks still-existing (disabled) providers as disconnected when stale-cleaned', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-disabled',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockResolvedValue([
        { applicationId: 'app-disabled', enabled: false, id: 'prov-disabled', platform: 'discord' },
      ]);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('prov-disabled');
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-disabled',
        platform: 'discord',
        status: 'disconnected',
      });
    });

    it('skips stale-connection cleanup when a platform provider query fails', async () => {
      // wechat providers fail to load → desired set incomplete → a healthy
      // wechat connection must NOT be treated as stale.
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) => {
        if (platform === 'wechat') throw new Error('db timeout');
        return [];
      });
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'wechat-prov',
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('still cleans live stale connections when registered-ids is unavailable', async () => {
      // Mid-rollout: gateway without /api/admin/registered-ids. The stats
      // snapshot alone must keep the stale pass alive for live connections,
      // while desired providers missing from the partial snapshot are deferred
      // instead of waking dormant DOs or being treated as disconnected.
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'stale-live',
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'gone',
          },
        ],
        total: 1,
      });
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('404 not found'));
      mockGatewayClient.getStatus.mockResolvedValue({ state: { status: 'dormant' } });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('stale-live');
      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalledWith('prov-1');
    });

    it('skips stale cleanup entirely when the provider recheck query fails', async () => {
      // Treating a failed recheck as "no rows" would bypass the TOCTOU guard
      // and could tear down a provider enabled mid-sync.
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'stale-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockRejectedValue(new Error('db timeout'));

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects the old DO of a webhook-switched provider without marking it disconnected', async () => {
      // An enabled provider switched from persistent to webhook mode: its old
      // gateway DO is stale and must go, but the row is served by the webhook
      // registration now — writing `disconnected` would make a working
      // channel look off (webhook-mode refreshes return the cached snapshot).
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockResolveConnectionMode.mockReturnValue('webhook');
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-webhook',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockResolvedValue([
        {
          applicationId: 'app-webhook',
          enabled: true,
          id: 'prov-webhook',
          platform: 'discord',
          settings: {},
        },
      ]);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('prov-webhook');
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app-webhook', status: 'disconnected' }),
      );
    });

    it('does not disconnect a provider enabled after the desired snapshot was built', async () => {
      // TOCTOU race: the user enables + connects a provider while the sync is
      // between buildDesiredConnections and fetchActualConnections. It shows
      // up in `actual` but not in `desired` — the fresh row recheck must keep
      // it connected.
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-race',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockResolvedValue([
        {
          applicationId: 'app-race',
          enabled: true,
          id: 'prov-race',
          platform: 'discord',
          settings: {},
        },
      ]);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app-race', status: 'disconnected' }),
      );
    });

    it('uses the stats snapshot instead of per-connection status calls', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('connects desired providers missing from the gateway snapshot', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1', platform: 'discord' }),
        { ensure: true },
      );
    });

    it('keeps (never stale-disconnects, never reconnects) providers whose credentials are undecryptable', async () => {
      // KEY_VAULTS_SECRET mishap scenario: the model returns the row with
      // empty credentials instead of dropping it — the connection must stay
      // untouched rather than being treated as stale.
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [{ applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' }]
          : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('requests the full enabled set including undecryptable rows', async () => {
      await service.ensureRunning();

      expect(mockFindEnabledByPlatform).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { includeUndecryptable: true },
      );
    });

    it('ensure-wakes registered-only desired ids instead of leaving them stranded', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('keeps a parked registered-only connection parked (ensure 409 is not a status reset)', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockRejectedValue(new Error('409 connection parked'));

      await service.ensureRunning();

      // The 409 must not overwrite the bot's runtime status with a fresh state.
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app-1', status: 'starting' }),
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('reconnects a desired connection reported disconnected by stats without probing its DO', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'disconnected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('reconciles 2,000 registered connections with two snapshot requests and no per-connection probes', async () => {
      const providers = Array.from({ length: 2000 }, (_, index) => ({
        ...provider,
        applicationId: `app-${index}`,
        id: `prov-${index}`,
      }));

      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? providers : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: providers.map(({ id }) => id),
      });

      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStats).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.getRegisteredIds).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      // Registered-only wakes are capped per round so a large fleet cannot
      // turn the reconcile into a wake storm; the remainder waits for the
      // next cron round.
      expect(mockGatewayClient.connect).toHaveBeenCalledTimes(50);
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('samples registered-only wakes instead of always burning the cap on the same prefix', async () => {
      // A stable iteration order + head-first cap would starve ids after
      // position 50 forever when the early ones stay registered-only (parked
      // 409s). Force the sampler's rng to pick from the tail and assert the
      // selection is not the head prefix.
      const providers = Array.from({ length: 2000 }, (_, index) => ({
        ...provider,
        applicationId: `app-${index}`,
        id: `prov-${index}`,
      }));

      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? providers : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: providers.map(({ id }) => id),
      });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999_999);
      try {
        await service.ensureRunning();
      } finally {
        randomSpy.mockRestore();
      }

      expect(mockGatewayClient.connect).toHaveBeenCalledTimes(50);
      const wokenIds = new Set(
        mockGatewayClient.connect.mock.calls.map(
          (call) => (call[0] as { connectionId: string }).connectionId,
        ),
      );
      // rng pinned to ~1 → the sampler reaches the tail; the old head-first
      // cap could only ever pick prov-0..prov-49 and would return exactly
      // that prefix.
      expect(wokenIds.has('prov-1999')).toBe(true);
      const isHeadPrefix = [...wokenIds].every((id) => Number(id.split('-')[1]) < 50);
      expect(isHeadPrefix).toBe(false);
    });

    it('uses registered ids as a complete existence snapshot when stats is unavailable', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      // With no stats, every desired id is registered-only (status unknown) —
      // still handled via the capped ensure wake, never a per-DO status probe.
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('defers missing desired ids when registered ids are unavailable', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registered unavailable'));

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('dual-host routing (node gateway configured)', () => {
    beforeEach(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = true;
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockNodeGatewayClient.isEnabled = true;
      mockNodeGatewayClient.connect.mockResolvedValue({ status: 'connecting' });
    });

    it('moves a bot provider to the node host: stale-disconnects on default, connects on node', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      // Provider row is enabled+polling, but routed to node — the TOCTOU
      // guard must NOT protect it on the default host.
      mockFindByIds.mockResolvedValue([
        {
          enabled: true,
          id: 'wechat-provider',
          platform: 'wechat',
          settings: {},
        },
      ]);
      // The connection currently lives on the default (CF) host.
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('wechat-provider');
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'wechat-provider', platform: 'wechat' }),
        { ensure: true },
      );
    });

    it('reconciles messenger polling links onto the node host and cleans the default host', async () => {
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'bot-1@im.bot',
          credentials: { baseUrl: 'https://ilink.example.com', botId: 'bot-1', botToken: 'tok' },
          tenantId: 'alice@im.wechat',
          userId: 'user-1',
        },
        // No token → never connectable, must be skipped.
        { applicationId: 'bot-2@im.bot', credentials: {}, tenantId: 'bob', userId: 'user-2' },
      ]);
      // A leftover per-user poller on the default host must be torn down
      // (double-hosting a polling platform double-delivers messages)…
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:alice@im.wechat:user-user-1'],
      });
      // …while an unlinked account's connection on the owning host is stale.
      mockNodeGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:gone:user-user-9'],
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith(
        'messenger:wechat:alice@im.wechat:user-user-1',
      );
      expect(mockNodeGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'bot-1@im.bot',
          connectionId: 'messenger:wechat:alice@im.wechat:user-user-1',
          connectionMode: 'polling',
          credentials: expect.objectContaining({
            botToken: 'tok',
            webhookToken: 'gateway-service-token',
          }),
          platform: 'wechat',
          userId: 'user-1',
          webhookPath: '/api/agent/messenger/webhooks/wechat',
        }),
        { ensure: true },
      );
      expect(mockNodeGatewayClient.connect).toHaveBeenCalledTimes(1);
      expect(mockNodeGatewayClient.disconnect).toHaveBeenCalledWith(
        'messenger:wechat:gone:user-user-9',
      );
    });

    it('skips live messenger connections and leaves other hosts untouched without a node gateway', async () => {
      mockNodeGateway.configured = false;
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'bot-1@im.bot',
          credentials: { botToken: 'tok' },
          tenantId: 'alice',
          userId: 'user-1',
        },
      ]);
      // Link already live on the default host → nothing to do.
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: { wechat: 1 },
        connections: [
          {
            connectionId: 'messenger:wechat:alice:user-user-1',
            platform: 'wechat',
            state: { status: 'connected' },
          },
        ],
        total: 1,
      });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:alice:user-user-1'],
      });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('routes per-user messenger registration to the node host', async () => {
      mockResolveMessengerInstallation.mockResolvedValue({
        applicationId: 'bot@im.wechat',
        botToken: 'secret-token',
      });

      // Fresh key/user — the module-level LRU cache persists across tests and
      // a cached connectionId would skip the connect this test asserts on.
      const connectionId = await service.ensureUserMessengerConnected({
        installationKey: 'wechat:carol@im.wechat',
        platform: 'wechat',
        userId: 'user-7',
      });

      expect(connectionId).toBe('messenger:wechat:carol@im.wechat:user-user-7');
      expect(mockNodeGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionMode: 'polling', platform: 'wechat' }),
      );
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('stays on the in-process runtime when the default host is unconfigured', async () => {
      // Node-only deployment. Gateway mode is a whole-process switch and the
      // Node gateway cannot host the webhook/websocket platforms that fall
      // back to `default`, so entering it here would strand them with no
      // in-process fallback. Out of scope by capability — see the note on
      // `isAnyMessageGatewayEnabled`.
      mockGatewayClient.isConfigured = false;
      mockGatewayClient.isEnabled = false;
      mockNodeGateway.platforms = ['wechat'];

      expect(service.useMessageGateway).toBe(false);
    });

    it('defers a cross-host move while the destination host has no usable snapshot', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindByIds.mockResolvedValue([
        { enabled: true, id: 'wechat-provider', platform: 'wechat', settings: {} },
      ]);
      // Live on the default host, routed to node — but node's admin surface is
      // down, so its connect pass would defer. Disconnecting here first would
      // take WeChat dark for the whole outage.
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });
      mockNodeGatewayClient.getStats.mockRejectedValue(new Error('node stats unavailable'));
      mockNodeGatewayClient.getRegisteredIds.mockRejectedValue(new Error('node registry down'));

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('never connects a messenger link the capped migration left running on the old host', async () => {
      // 60 linked users, all still polling on the default host. Cross-host
      // cleanup is capped at 50 per round, so connecting all 60 on node would
      // double-deliver for the 10 that were not drained.
      const links = Array.from({ length: 60 }, (_, i) => ({
        applicationId: 'bot-1@im.bot',
        credentials: { baseUrl: 'https://ilink.example.com', botId: 'bot-1', botToken: 'tok' },
        tenantId: `tenant-${i}`,
        userId: `user-${i}`,
      }));
      const strayIds = links.map((l) => `messenger:wechat:${l.tenantId}:user-${l.userId}`);
      mockFindAllLinksByPlatform.mockResolvedValue(links);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: strayIds });

      await service.ensureRunning();

      const drained = mockGatewayClient.disconnect.mock.calls.map((call) => call[0] as string);
      const connected = mockNodeGatewayClient.connect.mock.calls.map(
        (call) => (call[0] as { connectionId: string }).connectionId,
      );

      expect(drained).toHaveLength(50);
      // Every id connected on the new host was drained from the old one first,
      // and the undrained remainder is left for the next round.
      expect(connected.every((id: string) => drained.includes(id))).toBe(true);
      expect(connected).toHaveLength(50);
    });

    it('never connects a bot provider the capped stale pass left running on the old host', async () => {
      // 60 wechat providers all live on the default host and all routed to
      // node. Stale disconnects are capped at 50/round, so connecting all 60
      // on node would leave 10 running on both gateways.
      const providers = Array.from({ length: 60 }, (_, i) => ({
        applicationId: `wechat-app-${i}`,
        credentials: { botToken: 'token' },
        id: `wechat-provider-${i}`,
        settings: {},
        userId: `u${i}`,
      }));
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat' ? providers : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindByIds.mockImplementation(async (_db: unknown, ids: string[]) =>
        ids.map((id) => ({ enabled: true, id, platform: 'wechat', settings: {} })),
      );
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: providers.map((p) => p.id),
      });

      await service.ensureRunning();

      const drained = mockGatewayClient.disconnect.mock.calls.map((call) => call[0] as string);
      const connected = mockNodeGatewayClient.connect.mock.calls.map(
        (call) => (call[0] as { connectionId: string }).connectionId,
      );

      expect(drained).toHaveLength(50);
      expect(connected).toHaveLength(50);
      expect(connected.every((id: string) => drained.includes(id))).toBe(true);
    });

    it('completes a node-to-default rollback in one round, not the round after', async () => {
      // Rollback shape: node gateway still configured, but wechat is no longer
      // routed to it. `hosts` is ['default','node'], so a per-host sync would
      // run the destination first (deferring everything, nothing drained yet),
      // drain the source second, and never revisit the destination.
      mockNodeGateway.platforms = [];
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindByIds.mockResolvedValue([
        { enabled: true, id: 'wechat-provider', platform: 'wechat', settings: {} },
      ]);
      // Still live on node, which no longer owns it.
      mockNodeGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });

      await service.ensureRunning();

      expect(mockNodeGatewayClient.disconnect).toHaveBeenCalledWith('wechat-provider');
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'wechat-provider', platform: 'wechat' }),
        { ensure: true },
      );
    });

    it('makes no cross-host change when the messenger link lookup fails', async () => {
      mockFindAllLinksByPlatform.mockRejectedValue(new Error('db unavailable'));
      // A stray poller on the default host would normally be drained here —
      // draining it before discovering the links are unreadable would strand
      // that user offline until a later round.
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:alice@im.wechat:user-user-1'],
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('leaves an unusable link running on its current host instead of stranding the user', async () => {
      // Credentials fail to decrypt, so this link cannot be rebuilt on the
      // owning host. Draining it off the other host first would take the user
      // offline with nothing able to bring them back.
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'bot-1@im.bot',
          credentials: {},
          tenantId: 'alice@im.wechat',
          userId: 'user-1',
        },
      ]);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:alice@im.wechat:user-user-1'],
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('keeps a linked account whose credentials are undecryptable out of the stale pass', async () => {
      // decryptRow returns `credentials: {}` on a key-vault mismatch, which is
      // indistinguishable from "never had a token". Treating that as unlinked
      // would tear down every healthy poller in one round.
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'bot-1@im.bot',
          credentials: {},
          tenantId: 'alice@im.wechat',
          userId: 'user-1',
        },
      ]);
      mockNodeGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:alice@im.wechat:user-user-1'],
      });

      await service.ensureRunning();

      expect(mockNodeGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });
  });

  // ─── Routing a platform to a host that cannot serve it ───

  describe('platform capability guard', () => {
    const CONNECTION_ID = 'messenger:wechat:t1:user-u1';

    beforeEach(() => {
      mockGatewayClient.isEnabled = true;
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
      mockNodeGateway.configured = true;
      mockNodeGatewayClient.isConfigured = true;
      mockNodeGatewayClient.isEnabled = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
    });

    /** The default host is holding the WeChat poller; routing says it moves. */
    const defaultHostHoldsIt = () => {
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: { wechat: 1 },
        connections: [
          {
            connectionId: CONNECTION_ID,
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [CONNECTION_ID] });
    };

    // Draining into a host that rejects the platform is worse than doing
    // nothing: the connect meant to replace the connection fails, so it ends
    // up on neither host. A misrouted env var must be a no-op, not an outage.
    it('refuses to drain a platform off its host when the destination declines it', async () => {
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.getCapabilities.mockResolvedValue({
        platforms: ['whatsapp-baileys'],
      });
      defaultHostHoldsIt();

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });

    // Same fixture, guard off — proves the case above is the guard talking and
    // not a setup that never had a teardown to begin with.
    it('performs the same move when the destination declares the platform', async () => {
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.getCapabilities.mockResolvedValue({ platforms: ['wechat'] });
      defaultHostHoldsIt();

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith(CONNECTION_ID);
    });

    // The load-bearing half of the rule. The Cloudflare gateway has no
    // capabilities endpoint, so a rollback — clearing the platform list to
    // move connections BACK to it — targets a host that declares nothing.
    // Reading that silence as a refusal would make rollback impossible.
    it('does not treat a host that declares nothing as refusing anything', async () => {
      mockNodeGateway.platforms = [];
      mockGatewayClient.getCapabilities.mockResolvedValue(null);
      // The node host is the one still holding it — this is the rollback.
      mockNodeGatewayClient.getStats.mockResolvedValue({
        byPlatform: { wechat: 1 },
        connections: [
          {
            connectionId: CONNECTION_ID,
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockNodeGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [CONNECTION_ID] });
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });

      await service.ensureRunning();

      expect(mockNodeGatewayClient.disconnect).toHaveBeenCalledWith(CONNECTION_ID);
    });

    it('skips the connect for a bot-channel platform the host declines', async () => {
      mockNodeGateway.platforms = ['discord'];
      mockNodeGatewayClient.getCapabilities.mockResolvedValue({ platforms: ['wechat'] });
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockFindAllLinksByPlatform.mockResolvedValue([]);
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });

      await service.ensureRunning();

      expect(mockNodeGatewayClient.connect).not.toHaveBeenCalled();
    });
  });

  // ─── listDesiredConnectionsForHost (restart recovery, pull side) ───

  describe('listDesiredConnectionsForHost', () => {
    beforeEach(() => {
      mockGatewayClient.isEnabled = true;
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: { watchKeywords: [{ keyword: 'hi' }] },
                userId: 'u1',
              },
            ]
          : [],
      );
    });

    // The whole point of sharing one builder: whichever side establishes a
    // connection, the gateway ends up holding the same config. A drifting
    // second builder would show up here and nowhere else.
    it('hands back exactly the payload the reconcile would have pushed', async () => {
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();
      const pushed = mockGatewayClient.connect.mock.calls[0][0];

      const { connections } = await service.listDesiredConnectionsForHost('default');

      expect(connections).toHaveLength(1);
      expect(connections[0]).toEqual({ config: pushed, ensure: true });
    });

    // A pull changes nothing and wakes nothing. It reads another host's
    // registry to see what is still held there — two admin requests, no
    // fan-out — but it must never mutate a gateway, and never probe a single
    // connection's status, which is what would drag a dormant one up.
    it('reads, but never mutates a gateway or probes a connection', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;

      await service.listDesiredConnectionsForHost('node');

      for (const client of [mockGatewayClient, mockNodeGatewayClient]) {
        expect(client.connect).not.toHaveBeenCalled();
        expect(client.disconnect).not.toHaveBeenCalled();
        expect(client.disconnectAll).not.toHaveBeenCalled();
        expect(client.getStatus).not.toHaveBeenCalled();
      }
      // Its own host is never queried — the answer comes from the database.
      expect(mockNodeGatewayClient.getStats).not.toHaveBeenCalled();
    });

    it('returns only the requested host slice', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wx-app',
                credentials: { token: 'w' },
                id: 'prov-wechat',
                settings: {},
                userId: 'u-wx',
              },
            ]
          : [
              {
                applicationId: 'dc-app',
                credentials: { token: 'd' },
                id: `prov-${platform}`,
                settings: {},
                userId: 'u-dc',
              },
            ],
      );

      const node = await service.listDesiredConnectionsForHost('node');
      const def = await service.listDesiredConnectionsForHost('default');

      expect(node.connections.map((entry) => entry.config.connectionId)).toEqual(['prov-wechat']);
      expect(def.connections.map((entry) => entry.config.connectionId)).not.toContain(
        'prov-wechat',
      );
    });

    // One unreadable row used to be able to fail the whole recovery. A row
    // that can never connect is data we exclude, not a reason to leave a
    // gateway empty.
    it('excludes an undecryptable row without failing the call', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
              {
                applicationId: 'app-2',
                credentials: { token: 'x' },
                id: 'prov-2',
                settings: {},
                userId: 'u2',
              },
            ]
          : [],
      );

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.complete).toBe(true);
      expect(result.excluded).toBe(1);
      expect(result.connections.map((entry) => entry.config.connectionId)).toEqual(['prov-2']);
    });

    it('reports complete:false when a platform fails to load', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) => {
        if (platform === 'telegram') throw new Error('key vault unavailable');
        return [];
      });

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.complete).toBe(false);
    });

    it('includes messenger polling links and excludes ones with no usable token', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
        { applicationId: 'wx-app', credentials: {}, tenantId: 't2', userId: 'u2' },
      ]);

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.excluded).toBe(1);
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0].config).toMatchObject({
        connectionId: 'messenger:wechat:t1:user-u1',
        connectionMode: 'polling',
        credentials: {
          baseUrl: 'https://ilink',
          botId: 'bot-1',
          botToken: 'tok-1',
          webhookToken: 'gateway-service-token',
        },
        webhookPath: '/api/agent/messenger/webhooks/wechat',
      });
    });

    // Routing a platform here does not mean this host can run it. Handing over
    // credentials for a connection it will reject arms nothing and exposes
    // them for no reason — and the reconcile already refuses to move such a
    // platform, so leaving the gap here would put the two out of step.
    it('withholds credentials for a platform this host says it cannot serve', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockNodeGatewayClient.getCapabilities.mockResolvedValue({
        platforms: ['whatsapp-baileys'],
      });
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
    });

    // Today's production shape: the node URL is configured but no platform is
    // routed there yet. Deploying the node gateway must not drag the other
    // host's fleet over — it should be handed nothing at all.
    it('hands a host nothing while no platform is routed to it', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = [];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(0);
    });

    // Routing a platform here does not make its connections safe to build: the
    // host that owned them a moment ago is still polling. Handing one over
    // before that host is drained double-delivers every message.
    it('withholds a connection the previous host has not released yet', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      // The default host still holds it — mid-migration.
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:t1:user-u1'],
      });

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(1);
      // Partial answer, so the caller keeps asking rather than settling.
      expect(result.complete).toBe(false);
    });

    // A stats-only snapshot omits dormant registrations, so an id missing from
    // it proves nothing about whether the other host released it. Marking the
    // answer incomplete is not enough on its own: the caller applies what it
    // receives and only then asks again, so the flag would land after the
    // duplicate it was meant to prevent. The connection has to be withheld.
    it('withholds a connection the other host cannot be proven to have released', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      // Stats answered, registered-ids did not: a live host we can only half see.
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registry unavailable'));

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(1);
      expect(result.complete).toBe(false);
    });

    it('hands the connection over once the previous host has released it', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toHaveLength(1);
      expect(result.deferred).toBe(0);
      expect(result.complete).toBe(true);
    });

    // Same rule from the other direction: a host we could not reach shows
    // nothing, which is no more proof of release than a half-seen one. Restart
    // recovery is an optimisation over the reconcile, so when it cannot be done
    // safely the right move is not to do it.
    it('withholds when the other host cannot be read at all', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      mockGatewayClient.getStats.mockRejectedValue(new Error('admin down'));
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('admin down'));

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(1);
    });

    it('reports complete:false when messenger links fail to load', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockRejectedValue(new Error('link listing failed'));

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.complete).toBe(false);
    });
  });
});
