// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockFindAllLinksByPlatform,
  mockFindByIds,
  mockFindEnabledByPlatform,
  mockGatewayClient,
  mockGatewayEnv,
  mockNodeGateway,
  mockNodeGatewayClient,
  mockResolveConnectionMode,
  mockResolveMessengerInstallation,
  resetGatewayServiceMocks,
} from './testUtils';

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => m.envsGatewayModule()));
vi.mock('./MessageGatewayClient', () =>
  import('./testUtils').then((m) => m.messageGatewayClientModule()),
);
vi.mock('@/database/models/messengerAccountLink', () =>
  import('./testUtils').then((m) => m.messengerAccountLinkModule()),
);
vi.mock('./GatewayManager', () => import('./testUtils').then((m) => m.gatewayManagerModule()));
vi.mock('@/database/core/db-adaptor', () => import('./testUtils').then((m) => m.dbAdaptorModule()));
vi.mock('@/database/models/agentBotProvider', () =>
  import('./testUtils').then((m) => m.agentBotProviderModule()),
);
vi.mock('@/server/modules/KeyVaultsEncrypt', () =>
  import('./testUtils').then((m) => m.keyVaultsEncryptModule()),
);
vi.mock('./runtimeStatus', () => import('./testUtils').then((m) => m.runtimeStatusModule()));
vi.mock('@/business/server/bot/featureAccess', () =>
  import('./testUtils').then((m) => m.featureAccessModule()),
);
vi.mock('@/server/services/messenger/installations', () =>
  import('./testUtils').then((m) => m.messengerInstallationsModule()),
);
vi.mock('@/server/services/messenger/platforms', () =>
  import('./testUtils').then((m) => m.messengerPlatformsModule()),
);
vi.mock('../bot/platforms', () => import('./testUtils').then((m) => m.botPlatformsModule()));

describe('GatewayService', () => {
  let service: GatewayService;

  beforeEach(() => {
    resetGatewayServiceMocks();
    service = new GatewayService();
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
});
