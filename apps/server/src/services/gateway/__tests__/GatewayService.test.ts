// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Import after mocks ───
import { GatewayService } from '../index';

// ─── Hoisted mocks ───

const mockGatewayClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  disconnectAll: vi.fn(),
  getRegisteredIds: vi.fn(),
  getStats: vi.fn(),
  getStatus: vi.fn(),
  isConfigured: false,
  isEnabled: false,
}));

const mockGatewayEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_ENABLED: undefined as string | undefined,
}));

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

// ─── Module mocks ───

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: mockGatewayEnv,
}));

vi.mock('../MessageGatewayClient', () => ({
  getMessageGatewayClient: () => mockGatewayClient,
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
  getBotFeatureBlockedMessage: mockGetBotFeatureBlockedMessage,
  isBotFeatureAccessAllowed: mockIsBotFeatureAccessAllowed,
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
    // Default: admin snapshot unavailable → sync falls back to per-connection
    // getStatus and skips stale-connection cleanup (matches pre-reconciliation behavior).
    mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
    mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registered-ids unavailable'));
    mockUpdateBotRuntimeStatus.mockResolvedValue({});
    mockIsBotFeatureAccessAllowed.mockResolvedValue(true);
    mockGetBotFeatureBlockedMessage.mockReturnValue('This bot channel requires a paid plan.');
    mockGetBotRuntimeStatus.mockResolvedValue({});
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

    it('skips providers already present in the registered-id snapshot without probing status', async () => {
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

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
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

      // Fail-open: no disconnect, provider stays in the desired set.
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
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

    it('keeps registered-only ids without waking their connection DOs', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
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

      await service.ensureRunning();

      expect(mockGatewayClient.getStats).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.getRegisteredIds).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('uses registered ids as a complete existence snapshot when stats is unavailable', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
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
});
