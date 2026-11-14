// @vitest-environment node
/**
 * Concurrency of the in-process (non-Vercel) start path. Boot fires
 * `ensureRunning` from both instrumentation and the launcher's
 * `POST /gateway/start`, and a user connect can race them. Runs the real
 * GatewayManager so the assertions count connections opened, not mock wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as BotPlatforms from '../bot/platforms';
import type { PlatformClient, PlatformDefinition } from '../bot/platforms';
import { GatewayService } from '.';
import { getGatewayManager } from './GatewayManager';
import {
  mockFindEnabledByPlatform,
  mockFindEnabledByPlatformAndAppId,
  mockGatewayClient,
  resetGatewayServiceMocks,
} from './testUtils';

const { fakePlatforms } = vi.hoisted(() => ({ fakePlatforms: [] as PlatformDefinition[] }));

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => m.envsGatewayModule()));
vi.mock('./MessageGatewayClient', () =>
  import('./testUtils').then((m) => m.messageGatewayClientModule()),
);
vi.mock('@/database/models/messengerAccountLink', () =>
  import('./testUtils').then((m) => m.messengerAccountLinkModule()),
);
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
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
// Keep the real runtime-key / config helpers GatewayManager uses; only the
// registry is swapped for the fake platform below.
vi.mock('../bot/platforms', async (importOriginal) => ({
  ...(await importOriginal<typeof BotPlatforms>()),
  platformRegistry: {
    getPlatform: (id: string) => fakePlatforms.find((platform) => platform.id === id),
    listPlatforms: () => fakePlatforms,
  },
}));

/**
 * A QQ-like client: `start()` opens the WebSocket at once but only resolves
 * when the gateway sends READY, which the test releases by hand.
 */
interface FakeConnection {
  applicationId: string;
  ready: () => void;
  stopped: boolean;
}

let connections: FakeConnection[] = [];

const openConnections = () => connections.filter((connection) => !connection.stopped);

const createHandshakeClient = (config: { applicationId: string }): PlatformClient => {
  let ready!: () => void;
  const handshake = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const connection: FakeConnection = {
    applicationId: config.applicationId,
    ready: () => ready(),
    stopped: false,
  };

  return {
    applicationId: config.applicationId,
    createAdapter: () => ({}),
    extractChatId: (id: string) => id,
    getMessenger: () => ({
      createMessage: async () => {},
      editMessage: async () => {},
      removeReaction: async () => {},
      triggerTyping: async () => {},
    }),
    id: 'qq',
    parseMessageId: (id: string) => id,
    // Opening the socket is what logs `Initializing chat instance...`.
    start: vi.fn(() => {
      connections.push(connection);
      return handshake;
    }),
    stop: vi.fn(async () => {
      connection.stopped = true;
      ready();
    }),
  };
};

const qqDefinition = {
  clientFactory: { createClient: createHandshakeClient },
  connectionMode: 'websocket',
  id: 'qq',
  name: 'QQ',
  schema: [],
} as unknown as PlatformDefinition;

const provider = {
  applicationId: 'qq-app-1',
  credentials: { appSecret: 'secret' },
  enabled: true,
  id: 'prov-qq',
  platform: 'qq',
  settings: {},
  userId: 'owner-1',
  workspaceId: null,
};

/** Let every pending microtask (DB lookups, feature checks) settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GatewayService.ensureRunning concurrency (in-process manager)', () => {
  beforeEach(() => {
    resetGatewayServiceMocks();
    delete (globalThis as { gatewayManager?: unknown }).gatewayManager;
    connections = [];
    fakePlatforms.splice(0, fakePlatforms.length, qqDefinition);
    mockGatewayClient.isEnabled = false;
    mockFindEnabledByPlatform.mockResolvedValue([provider]);
    mockFindEnabledByPlatformAndAppId.mockResolvedValue(provider);
  });

  afterEach(() => {
    delete (globalThis as { gatewayManager?: unknown }).gatewayManager;
  });

  it('opens one connection when two ensureRunning calls race a start that has not reached READY', async () => {
    // Instrumentation register() and the launcher's POST /gateway/start.
    const boot = new GatewayService().ensureRunning();
    const launcher = new GatewayService().ensureRunning();
    await flush();

    // The QQ handshake is still pending, so neither caller sees a running
    // manager — the second must join the first start instead of syncing again.
    expect(connections).toHaveLength(1);
    expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
    expect(getGatewayManager()?.isRunning).toBe(false);

    connections[0].ready();
    await Promise.all([boot, launcher]);

    expect(getGatewayManager()?.isRunning).toBe(true);
    expect(connections).toHaveLength(1);
    expect(openConnections()).toHaveLength(1);
    expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
  });

  it('runs the leftover-gateway cleanup once for callers that joined the in-flight start', async () => {
    mockGatewayClient.isConfigured = true;
    mockGatewayClient.disconnectAll.mockResolvedValue({ total: 0 });

    const boot = new GatewayService().ensureRunning();
    const launcher = new GatewayService().ensureRunning();
    await flush();
    connections[0].ready();
    await Promise.all([boot, launcher]);

    expect(connections).toHaveLength(1);
    expect(mockGatewayClient.disconnectAll).toHaveBeenCalledTimes(1);
  });

  it('keeps a user connect that races the boot start to a single open connection', async () => {
    const boot = new GatewayService().ensureRunning();
    // connectBot → startClient lands while the boot handshake is in flight.
    const connect = new GatewayService().startClient('qq', 'qq-app-1', 'owner-1');
    await flush();

    expect(connections).toHaveLength(1);

    connections[0].ready();
    await boot;
    await flush();

    // startClient reconnects only after the boot start settled: the boot
    // connection is closed before the new one opens.
    expect(connections).toHaveLength(2);
    expect(connections[0].stopped).toBe(true);
    expect(openConnections()).toHaveLength(1);

    connections[1].ready();
    await expect(connect).resolves.toBe('started');

    expect(openConnections()).toHaveLength(1);
    expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
  });

  it('is a no-op once the manager is running', async () => {
    const first = new GatewayService().ensureRunning();
    await flush();
    connections[0].ready();
    await first;

    await new GatewayService().ensureRunning();

    expect(connections).toHaveLength(1);
    expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
  });
});
