import type * as DeviceControlModule from '@lobechat/device-control';
import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '../api/client';
import type * as RefreshModule from '../auth/refresh';
import { resolveToken } from '../auth/resolveToken';
import { removeStatus, spawnDaemon, stopDaemon, writeStatus } from '../daemon/manager';
import type * as DeviceRegister from '../device/register';
import { loadDeviceGatewayUrl, saveDeviceGatewayUrl } from '../settings';
import { executeToolCall } from '../tools';
import { cleanupAllProcesses } from '../tools/shell';
import { log, setVerbose } from '../utils/logger';
import { registerConnectCommand } from './connect';

const registerDeviceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../device/register', async (importOriginal) => {
  const actual = await importOriginal<typeof DeviceRegister>();
  return { ...actual, registerDevice: registerDeviceMock };
});

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn().mockResolvedValue({
    credentials: { accessToken: 'test-token', expiresAt: undefined, refreshToken: 'test-refresh' },
    status: 'ok',
  }),
}));
vi.mock('../auth/resolveToken', () => ({
  resolveToken: vi.fn().mockResolvedValue({
    serverUrl: 'https://app.lobehub.com',
    token: 'test-token',
    tokenType: 'jwt',
    userId: 'test-user',
  }),
}));
vi.mock('../settings', () => ({
  addWorkspaceEnrollment: vi.fn(),
  loadDeviceGatewayUrl: vi.fn(),
  loadOrCreateConnectionId: vi.fn().mockReturnValue('test-connection-id'),
  loadSettings: vi.fn().mockReturnValue(null),
  // Default: no persisted workspace shares, so runConnect skips the restore path.
  loadWorkspaceEnrollments: vi.fn().mockReturnValue([]),
  normalizeUrl: vi.fn((url?: string) => (url ? url.replace(/\/$/, '') : undefined)),
  removeWorkspaceEnrollment: vi.fn(),
  resolveDeviceMetricsBacklogPath: vi.fn((id: string) => `/tmp/device-metrics/${id}.json`),
  saveDeviceGatewayUrl: vi.fn(),
  saveSettings: vi.fn(),
}));

// `config.getGlobalConfig` on the server the token belongs to.
const getGlobalConfig = vi.hoisted(() => vi.fn());
const createPublicLambdaClientMock = vi.hoisted(() =>
  vi.fn(() => ({ config: { getGlobalConfig: { query: getGlobalConfig } } })),
);
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  createPublicLambdaClient: createPublicLambdaClientMock,
}));

const OFFICIAL_AUTH = {
  serverUrl: 'https://app.lobehub.com',
  token: 'test-token',
  tokenType: 'jwt' as const,
  userId: 'test-user',
};
const SELF_HOSTED = 'https://self-hosted.example.com';

vi.mock('../tools/shell', () => ({
  cleanupAllProcesses: vi.fn(),
}));

let mockRunningPid: number | null = null;
let mockSpawnedPid = 0;
let mockStatus: any = null;
vi.mock('../daemon/manager', () => ({
  appendLog: vi.fn(),
  getLogPath: vi.fn().mockReturnValue('/tmp/test-daemon.log'),
  getRunningDaemonPid: vi.fn().mockImplementation(() => mockRunningPid),
  readStatus: vi.fn().mockImplementation(() => mockStatus),
  removePid: vi.fn(),
  removeStatus: vi.fn(),
  reportDaemonStartupReady: vi.fn().mockResolvedValue(undefined),
  spawnDaemon: vi.fn().mockImplementation(() => {
    mockSpawnedPid = 99999;
    return mockSpawnedPid;
  }),
  stopDaemon: vi.fn().mockImplementation(() => {
    if (mockRunningPid !== null) {
      mockRunningPid = null;
      return true;
    }
    return false;
  }),
  writeStatus: vi.fn(),
}));

vi.mock('../tools', () => ({
  executeToolCall: vi.fn().mockResolvedValue({
    content: 'tool result',
    success: true,
  }),
}));

let clientEventHandlers: Record<string, (...args: any[]) => any> = {};
let clientOptions: any = {};
let connectCalled = false;
let lastSentToolResponse: any = null;
let lastSentSystemInfoResponse: any = null;
const clientReportMetrics = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const metricsSampler = vi.hoisted(() => ({
  flush: vi.fn().mockResolvedValue(undefined),
  options: undefined as any,
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@lobechat/device-control', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceControlModule>()),
  DeviceMetricsSampler: vi.fn().mockImplementation(function (opts: any) {
    metricsSampler.options = opts;
    return metricsSampler;
  }),
}));

vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  // Address resolution is real; only the socket is faked.
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayClient: vi.fn().mockImplementation(function (opts: any) {
    clientOptions = opts;
    clientEventHandlers = {};
    connectCalled = false;
    lastSentToolResponse = null;
    lastSentSystemInfoResponse = null;
    return {
      connect: vi.fn().mockImplementation(async () => {
        connectCalled = true;
      }),
      currentDeviceId: 'mock-device-id',
      disconnect: vi.fn(),
      on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        clientEventHandlers[event] = handler;
      }),
      reconnect: vi.fn().mockResolvedValue(undefined),
      reportMetrics: clientReportMetrics,
      sendRpcResponse: vi.fn(),
      sendSystemInfoResponse: vi.fn().mockImplementation((data: any) => {
        lastSentSystemInfoResponse = data;
      }),
      sendToolCallResponse: vi.fn().mockImplementation((data: any) => {
        lastSentToolResponse = data;
      }),
      updateToken: vi.fn(),
    };
  }),
}));

describe('connect command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let signalListeners: Map<NodeJS.Signals, Set<(...args: unknown[]) => void>>;

  beforeEach(() => {
    signalListeners = new Map(
      (['SIGINT', 'SIGTERM'] as const).map((signal) => [
        signal,
        new Set(process.listeners(signal)),
      ]),
    );
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    mockRunningPid = null;
    mockSpawnedPid = 0;
    mockStatus = null;
    clientOptions = {};
    vi.mocked(resolveToken).mockResolvedValue(OFFICIAL_AUTH);
    vi.mocked(loadDeviceGatewayUrl).mockReturnValue(undefined);
    getGlobalConfig.mockResolvedValue({ serverConfig: {} });
  });

  afterEach(() => {
    for (const [signal, existing] of signalListeners) {
      for (const listener of process.listeners(signal)) {
        if (!existing.has(listener)) process.removeListener(signal, listener);
      }
    }
    exitSpy.mockRestore();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerConnectCommand(program);
    return program;
  }

  it('should persist deviceId in status for foreground connections', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(writeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'connecting', deviceId: 'mock-device-id' }),
    );

    clientEventHandlers.connected?.();

    expect(writeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionStatus: 'connected', deviceId: 'mock-device-id' }),
    );
  });

  it('should persist deviceId in status for daemon child connections', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect', '--daemon-child']);

    expect(writeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'connecting', deviceId: 'mock-device-id' }),
    );

    clientEventHandlers.connected?.();

    expect(writeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionStatus: 'connected', deviceId: 'mock-device-id' }),
    );
  });

  it('samples machine health and pushes the backlog to the gateway on connect', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(metricsSampler.start).toHaveBeenCalled();
    const deviceId = clientOptions.deviceId;
    expect(metricsSampler.options.storagePath).toBe(`/tmp/device-metrics/${deviceId}.json`);

    clientEventHandlers.connected?.();
    expect(metricsSampler.flush).toHaveBeenCalled();

    const samples = [{ observedAt: 1 }] as any;
    await metricsSampler.options.upload(samples);
    expect(clientReportMetrics).toHaveBeenCalledWith(samples);
  });

  it('records the request on arrival and retains its timestamp across connection updates', async () => {
    const pending = Promise.withResolvers<{ content: string; success: boolean }>();
    vi.mocked(executeToolCall).mockImplementationOnce(() => pending.promise);
    await createProgram().parseAsync(['node', 'test', 'connect', '--daemon-child']);

    const running = clientEventHandlers.tool_call_request?.({
      requestId: 'req-1',
      toolCall: { apiName: 'readLocalFile', arguments: '{}', identifier: 'test' },
      type: 'tool_call_request',
    });
    const received = vi.mocked(writeStatus).mock.lastCall?.[0];
    expect(received).toEqual(
      expect.objectContaining({ deviceId: 'mock-device-id', lastRequestAt: expect.any(String) }),
    );
    clientEventHandlers.connected?.();
    expect(vi.mocked(writeStatus).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        connectionStatus: 'connected',
        lastRequestAt: received?.lastRequestAt,
      }),
    );
    pending.resolve({ content: 'ok', success: true });
    await running;
  });

  it('should connect to gateway', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(connectCalled).toBe(true);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('LobeHub CLI'));
  });

  describe('device gateway address', () => {
    const connect = (...args: string[]) =>
      createProgram().parseAsync(['node', 'test', 'connect', ...args]);

    it("connects to the gateway the token's server advertises when none is saved", async () => {
      vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
      getGlobalConfig.mockResolvedValue({
        serverConfig: { deviceGatewayUrl: 'https://gw.example.com/edge/' },
      });

      await connect();

      expect(createPublicLambdaClientMock).toHaveBeenCalledWith(SELF_HOSTED);
      expect(clientOptions).toMatchObject({
        gatewayUrl: 'https://gw.example.com/edge',
        serverUrl: SELF_HOSTED,
        token: 'test-token',
      });
      expect(writeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewaySource: 'server',
          gatewayUrl: 'https://gw.example.com/edge',
        }),
      );
      expect(log.info).toHaveBeenCalledWith(
        '  Gateway   : https://gw.example.com/edge (advertised by the server)',
      );
    });

    it.each([OFFICIAL_AUTH.serverUrl, SELF_HOSTED])(
      'uses the address saved for the token’s server ahead of its advertisement (%s)',
      async (serverUrl) => {
        vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl });
        vi.mocked(loadDeviceGatewayUrl).mockImplementation((server) =>
          server === serverUrl ? 'https://gw.saved.example' : undefined,
        );
        getGlobalConfig.mockResolvedValue({
          serverConfig: { deviceGatewayUrl: 'https://gw.example.com' },
        });

        await connect();

        // Saved, so the server is not even asked: a down server cannot block it.
        expect(getGlobalConfig).not.toHaveBeenCalled();
        expect(clientOptions.gatewayUrl).toBe('https://gw.saved.example');
        expect(log.info).toHaveBeenCalledWith(
          '  Gateway   : https://gw.saved.example (saved for this server)',
        );
        expect(saveDeviceGatewayUrl).not.toHaveBeenCalled();
      },
    );

    it('keeps the official gateway for official cloud when nothing is advertised or saved', async () => {
      await connect();

      expect(clientOptions.gatewayUrl).toBe('https://device-gateway.lobehub.com');
    });

    it('refuses to start without a gateway for a self-hosted server that advertises none', async () => {
      vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });

      await expect(connect()).rejects.toThrow(
        `${SELF_HOSTED} does not advertise a device gateway, and none is saved for it.`,
      );
      expect(clientOptions).toEqual({});
    });

    it.each([OFFICIAL_AUTH.serverUrl, SELF_HOSTED])(
      'does not fall back when the config lookup fails (%s)',
      async (serverUrl) => {
        vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl });
        getGlobalConfig.mockRejectedValue(new Error('HTTP 502'));

        await expect(connect()).rejects.toThrow('Could not read the device gateway address');
        expect(clientOptions).toEqual({});
      },
    );

    it('uses --gateway without a lookup and saves it for that server', async () => {
      vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
      vi.mocked(loadDeviceGatewayUrl).mockReturnValue('https://gw.saved.example');
      getGlobalConfig.mockRejectedValue(new Error('server down'));

      await connect('--gateway', 'https://gateway.example.com/');

      expect(getGlobalConfig).not.toHaveBeenCalled();
      expect(clientOptions.gatewayUrl).toBe('https://gateway.example.com');
      expect(saveDeviceGatewayUrl).toHaveBeenCalledWith(SELF_HOSTED, 'https://gateway.example.com');
    });

    it('opens workspace shares on the same gateway as the personal connection', async () => {
      vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
      getGlobalConfig.mockResolvedValue({
        serverConfig: { deviceGatewayUrl: 'https://gw.example.com' },
      });
      await connect();
      const personal = clientOptions;

      await clientEventHandlers['rpc_request']?.({
        method: 'enrollWorkspace',
        params: { token: 'ws-token', workspaceId: 'ws-1' },
        requestId: 'rpc-1',
        type: 'rpc_request',
      });

      expect(clientOptions).not.toBe(personal);
      expect(clientOptions).toMatchObject({
        gatewayUrl: 'https://gw.example.com',
        serverUrl: SELF_HOSTED,
        token: 'ws-token',
        workspaceId: 'ws-1',
      });
    });

    it('passes --gateway through to the daemon child, which resolves the same way', async () => {
      await connect('--daemon', '--gateway', 'https://gateway.example.com');

      expect(spawnDaemon).toHaveBeenCalledWith(
        expect.arrayContaining(['connect', '--gateway', 'https://gateway.example.com']),
      );
      // The parent resolves nothing itself; the child runs `runConnect`.
      expect(getGlobalConfig).not.toHaveBeenCalled();
    });
  });
  it('should pass the resolved serverUrl to GatewayClient', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(clientOptions.serverUrl).toBe('https://app.lobehub.com');
  });

  it('should handle tool call requests', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    // Trigger tool call
    await clientEventHandlers['tool_call_request']?.({
      requestId: 'req-1',
      toolCall: { apiName: 'readLocalFile', arguments: '{"path":"/test"}', identifier: 'test' },
      type: 'tool_call_request',
    });

    expect(executeToolCall).toHaveBeenCalledWith('readLocalFile', '{"path":"/test"}', undefined);
    expect(lastSentToolResponse).toEqual({
      requestId: 'req-1',
      result: {
        content: 'tool result',
        error: undefined,
        // Timed on this machine's clock, so the value is whatever the mock took
        // — what matters is that the device reports one at all: the server can
        // only observe the round trip, and cannot otherwise tell a slow tool
        // from slow transport.
        executionTimeMs: expect.any(Number),
        state: undefined,
        success: true,
      },
    });
    expect(lastSentToolResponse.result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle system info requests', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['system_info_request']?.({
      requestId: 'req-2',
      type: 'system_info_request',
    });

    expect(lastSentSystemInfoResponse).toBeDefined();
    expect(lastSentSystemInfoResponse.requestId).toBe('req-2');
    expect(lastSentSystemInfoResponse.result.success).toBe(true);
    expect(lastSentSystemInfoResponse.result.systemInfo).toHaveProperty('homePath');
    expect(lastSentSystemInfoResponse.result.systemInfo).toHaveProperty('arch');
  });

  it('should handle auth_failed', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    await clientEventHandlers['auth_failed']?.('invalid token');

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Authentication failed'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('stops when another connect process takes over the connection', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['replaced']?.();

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('took over'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should retry auth_failed with token refresh when new token available', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    vi.mocked(resolveToken).mockResolvedValueOnce({
      serverUrl: 'https://app.lobehub.com',
      token: 'refreshed-token',
      tokenType: 'jwt',
      userId: 'test-user',
    });

    const mockClient = vi.mocked(GatewayClient).mock.results[0].value;

    await clientEventHandlers['auth_failed']?.('token expired');

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Token refreshed'));
    expect(mockClient.updateToken).toHaveBeenCalledWith('refreshed-token');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should refresh token on auth_expired', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    vi.mocked(resolveToken).mockResolvedValueOnce({
      serverUrl: 'https://app.lobehub.com',
      token: 'new-token',
      tokenType: 'jwt',
      userId: 'user',
    });

    const mockClient = vi.mocked(GatewayClient).mock.results[0].value;

    await clientEventHandlers['auth_expired']?.();

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Token refreshed'));
    expect(mockClient.updateToken).toHaveBeenCalledWith('new-token');
    expect(mockClient.reconnect).toHaveBeenCalled();
    expect(cleanupAllProcesses).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should ignore auth_expired for api key auth', async () => {
    vi.mocked(resolveToken).mockResolvedValueOnce({
      serverUrl: 'https://self-hosted.example.com',
      token: 'test-api-key',
      tokenType: 'apiKey',
      userId: 'user',
    });
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.self-hosted.example.com' },
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    await clientEventHandlers['auth_expired']?.();

    expect(log.error).not.toHaveBeenCalled();
    expect(cleanupAllProcesses).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should handle error event', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['error']?.(new Error('connection lost'));

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

  it('should set verbose mode when -v flag is passed', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect', '-v']);

    expect(setVerbose).toHaveBeenCalledWith(true);
  });

  it('should handle SIGINT', async () => {
    const sigintHandlers: Array<() => Promise<void> | void> = [];
    const origOn = process.on;
    vi.spyOn(process, 'on').mockImplementation((event: any, handler: any) => {
      if (event === 'SIGINT') sigintHandlers.push(handler);
      return origOn.call(process, event, handler);
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    // Trigger SIGINT handler
    for (const handler of sigintHandlers) {
      await handler();
    }

    // Pending health samples get a bounded push before the socket closes.
    expect(metricsSampler.stop).toHaveBeenCalledWith({ flushTimeoutMs: 3000 });
    expect(metricsSampler.stop.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cleanupAllProcesses).mock.invocationCallOrder[0],
    );
    expect(cleanupAllProcesses).toHaveBeenCalled();
    expect(removeStatus).toHaveBeenCalled();
  });

  it('should handle auth_expired when refresh fails', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    // After initial connect, mock resolveToken to return falsy for the refresh attempt
    vi.mocked(resolveToken).mockResolvedValueOnce(undefined as any);

    await clientEventHandlers['auth_expired']?.();

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not refresh'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
  });

  it('should handle SIGTERM', async () => {
    const sigtermHandlers: Array<() => Promise<void> | void> = [];
    const origOn = process.on;
    vi.spyOn(process, 'on').mockImplementation((event: any, handler: any) => {
      if (event === 'SIGTERM') sigtermHandlers.push(handler);
      return origOn.call(process, event, handler);
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    for (const handler of sigtermHandlers) {
      await handler();
    }

    expect(cleanupAllProcesses).toHaveBeenCalled();
  });

  it('should generate correct system info with Movies for non-linux', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['system_info_request']?.({
      requestId: 'req-3',
      type: 'system_info_request',
    });

    const sysInfo = lastSentSystemInfoResponse.result.systemInfo;
    // On macOS (darwin), video dir should be Movies
    if (process.platform !== 'linux') {
      expect(sysInfo.videosPath).toContain('Movies');
    } else {
      expect(sysInfo.videosPath).toContain('Videos');
    }
  });

  describe('--daemon flag', () => {
    it('should spawn daemon and exit', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', '--daemon']);

      expect(spawnDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon started'));
    });

    it('should refuse if daemon already running', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', '--daemon']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('already running'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('connect stop', () => {
    it('should stop running daemon', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'stop']);

      expect(stopDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
    });

    it('should warn if no daemon is running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'stop']);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No daemon'));
    });
  });

  describe('disconnect (alias for connect stop)', () => {
    it('should stop running daemon', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'disconnect']);

      expect(stopDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
    });

    it('should warn if no daemon is running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'disconnect']);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No daemon'));
    });
  });

  describe('connect status', () => {
    it('should show no daemon running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'status']);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('No daemon'));
    });

    it('should show daemon status', async () => {
      mockRunningPid = 12345;
      mockStatus = {
        connectionStatus: 'connected',
        gatewayUrl: 'https://gateway.test.com',
        pid: 12345,
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
      };

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'status']);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon Status'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('12345'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('connected'));
    });
  });

  describe('connect restart', () => {
    it('should stop and start daemon', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'restart']);

      expect(stopDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Stopped existing'));
      expect(spawnDaemon).toHaveBeenCalled();
    });

    it('should start daemon even if none was running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'restart']);

      expect(spawnDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon started'));
    });
  });
});
