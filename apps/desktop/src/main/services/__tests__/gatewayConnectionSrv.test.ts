import { EventEmitter } from 'node:events';

import type { GatewayClient } from '@lobechat/device-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionService from '../gatewayConnectionSrv';

const { getShellInfoMock, execFileMock } = vi.hoisted(() => ({
  getShellInfoMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: execFileMock }),
}));
vi.mock('@/modules/cliEmbedding', () => ({ resolveCliScript: () => 'bundled-cli.js' }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('@lobechat/local-file-shell/shell', () => ({ getShellInfo: getShellInfoMock }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createClient = () =>
  ({ sendSystemInfoResponse: vi.fn() }) as unknown as GatewayClient & {
    sendSystemInfoResponse: ReturnType<typeof vi.fn>;
  };

describe('GatewayConnectionService system_info_request', () => {
  let service: GatewayConnectionService;

  beforeEach(() => {
    getShellInfoMock.mockReset();
    execFileMock
      .mockReset()
      .mockResolvedValue({ stdout: JSON.stringify({ supportedAgentRuntimes: [] }) });
    service = new GatewayConnectionService({} as App);
  });

  it('answers with the collected system info', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    const client = createClient();

    await (service as any).handleSystemInfoRequest(client, { requestId: 'req-1' });

    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: {
        success: true,
        systemInfo: expect.objectContaining({
          defaultShell: 'zsh',
          homePath: '/mock/path/home',
          picturesPath: '/mock/path/pictures',
        }),
      },
    });
  });

  /** @example A capable bundled CLI enables native app-server runs on a Desktop gateway connection. */
  it('advertises the native runtimes reported by the bundled execution CLI', async () => {
    // ROOT CAUSE:
    // Desktop forwards agent runs to its bundled CLI but omitted native capabilities
    // from system-info, so the server could never select the native runtime for it.
    // Probe that bundled runtime instead of a potentially older global lh binary.
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ supportedAgentRuntimes: ['codex-app-server-v1'] }),
    });
    const client = createClient();
    await service['handleSystemInfoRequest'](client, {
      requestId: 'native-desktop',
      type: 'system_info_request',
    });
    /** @example The live system-info response supplies the server's dispatch capability. */
    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          success: true,
          systemInfo: expect.objectContaining({ supportedAgentRuntimes: ['codex-app-server-v1'] }),
        },
      }),
    );
    /** @example The probe executes the bundled CLI under Electron's Node runtime. */
    expect(execFileMock).toHaveBeenCalledWith(
      process.execPath,
      ['bundled-cli.js', 'connect', 'capabilities'],
      expect.objectContaining({
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
        timeout: 9000,
        windowsHide: true,
      }),
    );
  });

  // ROOT CAUSE:
  // Every system_info_request spawned the bundled CLI (up to 9 s) plus a Codex handshake,
  // and system info is queried during ordinary runs, so every device user paid for it.
  /** @example Repeated system-info requests reuse one bundled CLI probe per connection. */
  it('probes the bundled CLI once per connection', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ supportedAgentRuntimes: ['codex-app-server-v1'] }),
    });
    const client = createClient();
    for (const requestId of ['first', 'second', 'third']) {
      await service['handleSystemInfoRequest'](client, {
        requestId,
        type: 'system_info_request',
      });
    }
    expect(execFileMock).toHaveBeenCalledOnce();
    expect(client.sendSystemInfoResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestId: 'third',
        result: {
          success: true,
          systemInfo: expect.objectContaining({ supportedAgentRuntimes: ['codex-app-server-v1'] }),
        },
      }),
    );
  });

  /** @example Updating or removing Codex changes the capability after reconnecting. */
  it('revokes native support when a reconnect probe fails', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    execFileMock.mockResolvedValueOnce({
      stdout: JSON.stringify({ supportedAgentRuntimes: ['codex-app-server-v1'] }),
    });
    const client = createClient();
    await service['handleSystemInfoRequest'](client, {
      requestId: 'first',
      type: 'system_info_request',
    });
    execFileMock.mockRejectedValueOnce(new Error('bundled CLI unavailable or timed out'));
    // Only the status transition matters here; keep-awake and broadcasting are out of scope.
    vi.spyOn(service as any, 'syncPowerSaveBlocker').mockImplementation(() => {});
    vi.spyOn(service as any, 'scheduleStatusBroadcast').mockImplementation(() => {});
    service['setStatus']('reconnecting');
    service['setStatus']('connected');
    await service['handleSystemInfoRequest'](client, {
      requestId: 'second',
      type: 'system_info_request',
    });
    /** @example A failed probe preserves other device tools but cannot authorize native runs. */
    expect(client.sendSystemInfoResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestId: 'second',
        result: {
          success: true,
          systemInfo: expect.objectContaining({ supportedAgentRuntimes: [] }),
        },
      }),
    );
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  /** @example An older CLI's help output must not be interpreted as native support. */
  it('omits native support when the bundled probe returns malformed output', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'zsh' });
    execFileMock.mockResolvedValue({ stdout: 'Usage: lh connect' });
    const client = createClient();
    await service['handleSystemInfoRequest'](client, {
      requestId: 'malformed',
      type: 'system_info_request',
    });
    /** @example Ordinary system information remains available after a probe failure. */
    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          success: true,
          systemInfo: expect.objectContaining({ supportedAgentRuntimes: [] }),
        },
      }),
    );
  });

  it('omits an optional folder Electron cannot resolve and still answers successfully', async () => {
    getShellInfoMock.mockResolvedValue({ displayName: 'pwsh' });
    const { app } = await import('electron');
    const getPath = vi.mocked(app.getPath);
    const original = getPath.getMockImplementation();
    getPath.mockImplementation((name: string) => {
      if (name === 'pictures') throw new Error("Failed to get 'pictures' path");
      return `/mock/path/${name}`;
    });
    const client = createClient();

    try {
      await (service as any).handleSystemInfoRequest(client, { requestId: 'req-3' });
    } finally {
      getPath.mockImplementation(original!);
    }

    const [response] = client.sendSystemInfoResponse.mock.calls[0];
    expect(response.requestId).toBe('req-3');
    expect(response.result.success).toBe(true);
    expect(response.result.systemInfo.picturesPath).toBeUndefined();
    expect(response.result.systemInfo.homePath).toBe('/mock/path/home');
  });

  it('still answers with a failure when collecting system info rejects', async () => {
    getShellInfoMock.mockRejectedValue(new Error('shell probe failed'));
    const client = createClient();

    await expect(
      (service as any).handleSystemInfoRequest(client, { requestId: 'req-2' }),
    ).resolves.toBeUndefined();

    expect(client.sendSystemInfoResponse).toHaveBeenCalledWith({
      requestId: 'req-2',
      result: { success: false },
    });
  });
});

describe('GatewayConnectionService power save blocker', () => {
  let service: GatewayConnectionService;
  let store: Record<string, unknown>;

  beforeEach(async () => {
    const { powerSaveBlocker } = await import('electron');
    vi.mocked(powerSaveBlocker.start).mockReset().mockReturnValue(7);
    vi.mocked(powerSaveBlocker.stop).mockReset();

    store = {};
    const app = {
      browserManager: { broadcastToAllWindows: vi.fn() },
      storeManager: {
        get: vi.fn((key: string, fallback?: unknown) => (key in store ? store[key] : fallback)),
        set: vi.fn((key: string, value: unknown) => {
          store[key] = value;
        }),
      },
    } as unknown as App;
    service = new GatewayConnectionService(app);
  });

  const setStatus = (status: string) => (service as any).setStatus(status);

  it('keeps the blocker through a transient reconnect', async () => {
    const { powerSaveBlocker } = await import('electron');

    setStatus('connected');
    setStatus('reconnecting');
    setStatus('connecting');
    setStatus('authenticating');
    setStatus('connected');

    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled();
  });

  it('releases the blocker once the connection settles on disconnected', async () => {
    const { powerSaveBlocker } = await import('electron');

    setStatus('connected');
    setStatus('disconnected');

    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(7);
  });

  it('never holds the blocker when keep-awake is turned off', async () => {
    const { powerSaveBlocker } = await import('electron');
    store.gatewayKeepAwake = false;

    setStatus('connecting');
    setStatus('connected');

    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
  });

  it('applies a keep-awake toggle to the live connection immediately', async () => {
    const { powerSaveBlocker } = await import('electron');
    setStatus('connected');

    service.setKeepAwake(false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(7);
    expect(service.getKeepAwake()).toBe(false);

    service.setKeepAwake(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2);
  });

  it('does not start the blocker from a toggle while disconnected', async () => {
    const { powerSaveBlocker } = await import('electron');

    service.setKeepAwake(true);

    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
  });
});

describe('GatewayConnectionService status broadcast', () => {
  let service: GatewayConnectionService;
  let broadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn();
    const app = {
      browserManager: { broadcastToAllWindows: broadcast },
      storeManager: { get: vi.fn((_key: string, fallback?: unknown) => fallback), set: vi.fn() },
    } as unknown as App;
    service = new GatewayConnectionService(app);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setStatus = (status: string) => (service as any).setStatus(status);
  const broadcastStatuses = () => broadcast.mock.calls.map(([, payload]) => payload.status);

  it('hides a reconnect that recovers within the grace period', () => {
    setStatus('connecting');
    setStatus('authenticating');
    setStatus('connected');
    broadcast.mockClear();

    setStatus('reconnecting');
    setStatus('connecting');
    setStatus('authenticating');
    vi.advanceTimersByTime(3000);
    setStatus('connected');
    vi.advanceTimersByTime(10_000);

    expect(broadcast).not.toHaveBeenCalled();
    expect(service.getDisplayedStatus()).toBe('connected');
    expect(service.getStatus()).toBe('connected');
  });

  it('surfaces a reconnect that outlasts the grace period', () => {
    setStatus('connected');
    broadcast.mockClear();

    setStatus('reconnecting');
    setStatus('connecting');
    expect(service.getDisplayedStatus()).toBe('connected');

    vi.advanceTimersByTime(5000);
    expect(broadcastStatuses()).toEqual(['connecting']);

    setStatus('authenticating');
    setStatus('connected');
    expect(broadcastStatuses()).toEqual(['connecting', 'authenticating', 'connected']);
  });

  it('shows an explicit disconnect immediately', () => {
    setStatus('connected');
    broadcast.mockClear();

    setStatus('disconnected');

    expect(broadcastStatuses()).toEqual(['disconnected']);
  });
});

describe('GatewayConnectionService auth recovery', () => {
  const SERVER_URL = 'https://server.example.com';
  /** The login a connection belongs to, as `doConnect` binds it. */
  const SESSION = {
    accountKey: `${SERVER_URL}#user-1`,
    endpoint: { source: 'server', url: 'https://gw.example.com' },
    serverKey: SERVER_URL,
    serverUrl: SERVER_URL,
    userId: 'user-1',
  };

  let service: GatewayConnectionService;
  let doConnect: ReturnType<typeof vi.fn>;
  let clients: ReturnType<typeof createFakeClient>[];

  const createFakeClient = () => {
    const client = new EventEmitter() as any;
    client.connect = vi.fn().mockResolvedValue(undefined);
    client.disconnect = vi.fn().mockResolvedValue(undefined);
    client.reconnect = vi.fn().mockResolvedValue(undefined);
    client.updateToken = vi.fn();
    return client as GatewayClient & {
      disconnect: ReturnType<typeof vi.fn>;
      reconnect: ReturnType<typeof vi.fn>;
      updateToken: ReturnType<typeof vi.fn>;
    };
  };

  /** Unsigned JWT: the service only reads `sub` from it. */
  const jwtFor = (sub: string) =>
    [
      Buffer.from('{"alg":"none"}').toString('base64url'),
      Buffer.from(JSON.stringify({ sub })).toString('base64url'),
      'sig',
    ].join('.');

  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  /**
   * What a connection attempt leaves behind: a new attempt generation and a
   * fresh client bound to the same login as the current connection.
   */
  const bindClient = () => {
    const client = createFakeClient();
    (service as any).invalidateAttempts();
    (service as any).session = { ...SESSION };
    (service as any).client = client;
    (service as any).setupClientEvents(client);
    clients.push(client);
    return client;
  };

  /** Flush the async handlers that the event listeners kick off without awaiting. */
  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(() => {
    const app = {
      browserManager: { broadcastToAllWindows: vi.fn() },
      storeManager: {
        delete: vi.fn(),
        get: vi.fn((_key: string, fallback?: unknown) => fallback),
        set: vi.fn(),
      },
    } as unknown as App;
    service = new GatewayConnectionService(app);
    clients = [];
    doConnect = vi.fn(async () => {
      bindClient();
      return { success: true };
    });
    (service as any).doConnect = doConnect;
  });

  describe('personal connection', () => {
    it('refreshes the token and reconnects after auth_failed', async () => {
      const refresher = vi.fn().mockResolvedValue({ success: true });
      service.setTokenRefresher(refresher);
      const client = bindClient();

      client.emit('auth_failed', 'exp claim timestamp check failed');
      await flush();

      expect(refresher).toHaveBeenCalledTimes(1);
      expect(doConnect).toHaveBeenCalledTimes(1);
      expect(client.disconnect).toHaveBeenCalled();
      expect((service as any).client).toBe(clients[1]);
    });

    it('retries only once when the refreshed token is rejected again', async () => {
      const refresher = vi.fn().mockResolvedValue({ success: true });
      service.setTokenRefresher(refresher);
      bindClient().emit('auth_failed', 'exp claim timestamp check failed');
      await flush();

      clients[1].emit('auth_failed', 'exp claim timestamp check failed');
      await flush();

      expect(refresher).toHaveBeenCalledTimes(1);
      expect(doConnect).toHaveBeenCalledTimes(1);
      expect(service.getStatus()).toBe('disconnected');
      // The rejection that ends the recovery is what the user sees.
      expect(service.getDisplayedState()).toEqual({
        error: { code: 'auth_failed', detail: 'exp claim timestamp check failed' },
        status: 'disconnected',
      });
    });

    it('gives the retry budget back once a connection authenticates', async () => {
      const refresher = vi.fn().mockResolvedValue({ success: true });
      service.setTokenRefresher(refresher);
      bindClient().emit('auth_failed', 'first');
      await flush();

      clients[1].emit('connected');
      clients[1].emit('auth_failed', 'second');
      await flush();

      expect(refresher).toHaveBeenCalledTimes(2);
      expect(doConnect).toHaveBeenCalledTimes(2);
    });

    it('gives the retry budget back on a user connect', async () => {
      const refresher = vi.fn().mockResolvedValue({ success: true });
      service.setTokenRefresher(refresher);
      bindClient().emit('auth_failed', 'first');
      await flush();
      clients[1].emit('auth_failed', 'again');
      await flush();
      expect(service.getStatus()).toBe('disconnected');

      await service.connect();
      clients[2].emit('auth_failed', 'after the user retried');
      await flush();

      expect(refresher).toHaveBeenCalledTimes(2);
      expect(doConnect).toHaveBeenCalledTimes(3);
    });

    it('stays disconnected without looping when the refresh fails', async () => {
      const refresher = vi.fn().mockResolvedValue({ success: false, error: 'invalid_grant' });
      service.setTokenRefresher(refresher);

      bindClient().emit('auth_failed', 'exp claim timestamp check failed');
      await flush();

      expect(refresher).toHaveBeenCalledTimes(1);
      expect(doConnect).not.toHaveBeenCalled();
      expect(service.getStatus()).toBe('disconnected');
      expect(service.getDisplayedState().error).toEqual({
        code: 'auth_failed',
        detail: 'invalid_grant',
      });
    });

    it('pushes a refreshed token into the live client', () => {
      const client = bindClient();

      service.updatePersonalToken(jwtFor('user-1'));

      expect(client.updateToken).toHaveBeenCalledWith(jwtFor('user-1'));
    });

    it("never pushes another account's token into the live connection", () => {
      const client = bindClient();

      // A new sign-in stores its token before it rebuilds the connection.
      service.updatePersonalToken(jwtFor('user-2'));

      expect(client.updateToken).not.toHaveBeenCalled();
    });

    describe('late events', () => {
      it('ignores an auth_failed that arrives after sign-out', async () => {
        const refresher = vi.fn().mockResolvedValue({ success: true });
        service.setTokenRefresher(refresher);
        const client = bindClient();

        await service.disconnect();
        client.emit('auth_failed', 'late');
        await flush();

        expect(refresher).not.toHaveBeenCalled();
        expect(doConnect).not.toHaveBeenCalled();
        expect(service.getStatus()).toBe('disconnected');
      });

      it('does not reconnect when signed out while the refresh is in flight', async () => {
        const refresh = deferred<{ success: boolean }>();
        service.setTokenRefresher(() => refresh.promise);
        bindClient().emit('auth_failed', 'exp claim timestamp check failed');
        await flush();

        await service.disconnect();
        refresh.resolve({ success: true });
        await flush();

        expect(doConnect).not.toHaveBeenCalled();
        expect((service as any).client).toBeNull();
      });

      it("does not spend the current connection's retry on a replaced client's rejection", async () => {
        const refresher = vi.fn().mockResolvedValue({ success: true });
        service.setTokenRefresher(refresher);
        const replaced = bindClient();
        // A new sign-in replaced the connection before the old verdict landed.
        const current = bindClient();

        replaced.emit('auth_failed', 'late');
        await flush();
        current.emit('auth_failed', 'exp claim timestamp check failed');
        await flush();

        expect(refresher).toHaveBeenCalledTimes(1);
        expect(doConnect).toHaveBeenCalledTimes(1);
      });

      it("does not take a replaced client's late success as the current one's", async () => {
        const refresher = vi.fn().mockResolvedValue({ success: true });
        service.setTokenRefresher(refresher);
        const first = bindClient();
        first.emit('auth_failed', 'first');
        await flush();

        first.emit('connected');
        clients[1].emit('auth_failed', 'rejected again');
        await flush();

        expect(refresher).toHaveBeenCalledTimes(1);
        expect(doConnect).toHaveBeenCalledTimes(1);
        expect(service.getStatus()).toBe('disconnected');
      });
    });
  });

  describe('workspace connection', () => {
    const setupWorkspace = (workspaceId: string) => {
      (service as any).session = { ...SESSION };
      const client = createFakeClient();
      (service as any).workspaceClients.set(workspaceId, client);
      (service as any).setupClientEvents(client, { workspaceId });
      return client;
    };

    it('re-mints the connect token and reconnects after auth_failed', async () => {
      const client = setupWorkspace('ws-1');
      const mint = vi.fn().mockResolvedValue('ws-token');
      service.setWorkspaceTokenProvider(mint);

      client.emit('auth_failed', 'token expired');
      await flush();

      expect(mint).toHaveBeenCalledWith('ws-1', SERVER_URL);
      expect(client.updateToken).toHaveBeenCalledWith('ws-token');
      expect(client.reconnect).toHaveBeenCalledTimes(1);
      expect((service as any).workspaceClients.has('ws-1')).toBe(true);
    });

    it('closes the share instead of looping when it fails again', async () => {
      const client = setupWorkspace('ws-1');
      const mint = vi.fn().mockResolvedValue('ws-token');
      service.setWorkspaceTokenProvider(mint);

      client.emit('auth_failed', 'token expired');
      await flush();
      client.emit('auth_failed', 'token expired');
      await flush();

      expect(mint).toHaveBeenCalledTimes(1);
      expect(client.disconnect).toHaveBeenCalledTimes(1);
      expect((service as any).workspaceClients.has('ws-1')).toBe(false);
    });

    it('gives a share its retry back once it authenticates', async () => {
      const client = setupWorkspace('ws-1');
      const mint = vi.fn().mockResolvedValue('ws-token');
      service.setWorkspaceTokenProvider(mint);

      client.emit('auth_failed', 'first');
      await flush();
      client.emit('connected');
      client.emit('auth_failed', 'second');
      await flush();

      expect(mint).toHaveBeenCalledTimes(2);
      expect(client.reconnect).toHaveBeenCalledTimes(2);
      expect((service as any).workspaceClients.has('ws-1')).toBe(true);
    });

    it('closes the share when the connect token cannot be re-minted', async () => {
      const client = setupWorkspace('ws-1');
      service.setWorkspaceTokenProvider(vi.fn().mockResolvedValue(null));

      client.emit('auth_failed', 'token expired');
      await flush();

      expect(client.reconnect).not.toHaveBeenCalled();
      expect((service as any).workspaceClients.has('ws-1')).toBe(false);
    });

    it('ignores an auth_failed from a share already closed by sign-out', async () => {
      const client = setupWorkspace('ws-1');
      const mint = vi.fn().mockResolvedValue('ws-token');
      service.setWorkspaceTokenProvider(mint);

      await service.disconnect();
      client.emit('auth_failed', 'late');
      await flush();

      expect(mint).not.toHaveBeenCalled();
      expect(client.reconnect).not.toHaveBeenCalled();
    });

    it("never closes a re-enrolled share on the replaced client's late rejection", async () => {
      const replaced = setupWorkspace('ws-1');
      service.setWorkspaceTokenProvider(vi.fn().mockResolvedValue('ws-token'));
      replaced.emit('auth_failed', 'first');
      await flush();

      // Re-enrolled: a new client owns the share now.
      const current = setupWorkspace('ws-1');
      replaced.emit('auth_failed', 'late');
      await flush();

      expect((service as any).workspaceClients.get('ws-1')).toBe(current);
      expect(current.disconnect).not.toHaveBeenCalled();
    });

    it('does not re-key a share when signed out during the re-mint', async () => {
      const client = setupWorkspace('ws-1');
      const minted = deferred<string>();
      service.setWorkspaceTokenProvider(() => minted.promise);

      client.emit('auth_failed', 'token expired');
      await flush();
      await service.disconnect();
      minted.resolve('ws-token');
      await flush();

      expect(client.updateToken).not.toHaveBeenCalled();
      expect(client.reconnect).not.toHaveBeenCalled();
    });
  });
});

const deriveDeviceIdMock = vi.hoisted(() =>
  vi.fn((userId: string) => ({ deviceId: `stable-${userId}`, identitySource: 'machine' })),
);

vi.mock('@lobechat/device-identity', () => ({ deriveDeviceId: deriveDeviceIdMock }));

describe('GatewayConnectionService resolveCurrentDeviceId', () => {
  const jwt = (sub: string) =>
    ['h', Buffer.from(JSON.stringify({ sub })).toString('base64url'), 's'].join('.');

  const createService = () => {
    const app = {
      browserManager: { broadcastToAllWindows: vi.fn() },
      storeManager: { get: vi.fn(() => 'fallback-uuid'), set: vi.fn() },
    } as unknown as App;
    const service = new GatewayConnectionService(app);
    service.loadOrCreateDeviceId();
    return service;
  };

  // Regression: before the gateway connected, topic pins stored the install's
  // fallback UUID, which stops naming this machine once the identity is derived.
  it('derives the signed-in user stable id instead of the pre-connect fallback', async () => {
    const service = createService();
    service.setTokenProvider(async () => jwt('user-1'));

    expect(service.getDeviceInfo().deviceId).toBe('fallback-uuid');
    await expect(service.resolveCurrentDeviceId()).resolves.toBe('stable-user-1');
  });

  it('returns nothing while signed out', async () => {
    const service = createService();
    service.setTokenProvider(async () => null);

    await expect(service.resolveCurrentDeviceId()).resolves.toBeUndefined();
  });

  // Regression: every send re-derived the identity, a synchronous machine-id
  // read in Electron's main process, despite the documented session cache.
  it('derives the identity once per user and again when the user changes', async () => {
    const service = createService();
    let user = 'user-1';
    service.setTokenProvider(async () => jwt(user));
    deriveDeviceIdMock.mockClear();

    await service.resolveCurrentDeviceId();
    await service.resolveCurrentDeviceId();
    expect(deriveDeviceIdMock).toHaveBeenCalledTimes(1);

    user = 'user-2';
    await expect(service.resolveCurrentDeviceId()).resolves.toBe('stable-user-2');
    expect(deriveDeviceIdMock).toHaveBeenCalledTimes(2);
  });
});
