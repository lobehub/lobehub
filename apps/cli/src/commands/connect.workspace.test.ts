import type * as DeviceControlModule from '@lobechat/device-control';
import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '../api/client';
import type * as RefreshModule from '../auth/refresh';
import { resolveToken } from '../auth/resolveToken';
import type * as DeviceRegister from '../device/register';
import { resolveWorkspaceDeviceIdentity } from '../device/register';
import type * as SystemInfoModule from '../device/systemInfo';
import type * as ServiceStatusModule from '../service/status';
import { loadDeviceGatewayUrl, loadWorkspaceEnrollments } from '../settings';
import { registerConnectCommand } from './connect';

const systemService = vi.hoisted(() => ({ enabled: false }));
vi.mock('../service/status', async (importOriginal) => ({
  ...(await importOriginal<typeof ServiceStatusModule>()),
  readConnectServices: async () => ({
    services: systemService.enabled
      ? [
          {
            active: true,
            enabled: true,
            fragmentPath: '/etc/systemd/system/lobehub-connect.service',
            mainPid: 4567,
            scope: 'system',
            serviceName: 'lobehub-connect.service',
            subState: 'running',
            user: 'ubuntu',
          },
        ]
      : [],
    unavailableScopes: [],
  }),
}));

// Native runtime probing spawns Codex; connect.nativeRuntimes.test.ts covers it.
vi.mock('../device/systemInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof SystemInfoModule>()),
  probeNativeRuntimes: vi.fn().mockResolvedValue([]),
}));

const registerDeviceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mintWorkspaceConnectTokenMock = vi.hoisted(() => vi.fn());
const registerWorkspaceDeviceMock = vi.hoisted(() => vi.fn());

vi.mock('../device/register', async (importOriginal) => {
  const actual = await importOriginal<typeof DeviceRegister>();
  return {
    ...actual,
    mintWorkspaceConnectToken: mintWorkspaceConnectTokenMock,
    registerDevice: registerDeviceMock,
    registerWorkspaceDevice: registerWorkspaceDeviceMock,
  };
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
// Worktree cleanups that waited for this device, drained on every connect.
const drainWorktreeCleanups = vi.hoisted(() => vi.fn(async () => ({ scheduled: true })));
const createLambdaClientMock = vi.hoisted(() =>
  vi.fn(() => ({ device: { drainWorktreeCleanups: { mutate: drainWorktreeCleanups } } })),
);
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  createLambdaClient: createLambdaClientMock,
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
  stopDaemonAndWait: vi.fn().mockImplementation(async () => {
    const wasRunning = mockRunningPid !== null;
    mockRunningPid = null;
    return wasRunning;
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
      sendSystemInfoResponse: vi.fn(),
      sendToolCallResponse: vi.fn(),
      updateToken: vi.fn(),
    };
  }),
}));

describe('connect command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let signalListeners: Map<NodeJS.Signals, Set<(...args: unknown[]) => void>>;

  beforeEach(() => {
    vi.stubEnv('LOBEHUB_CONNECT_SERVICE', undefined);
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerConnectCommand(program);
    return program;
  }

  it('exits with a retryable code when the workspace token mint fails transiently', async () => {
    mintWorkspaceConnectTokenMock.mockRejectedValueOnce(new Error('fetch failed'));

    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'test', 'connect', '--workspace', 'ws_1']),
    ).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(75);
  });

  it('exits without retry when the server refuses the workspace token mint', async () => {
    mintWorkspaceConnectTokenMock.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { data: { code: 'FORBIDDEN' } }),
    );

    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'test', 'connect', '--workspace', 'ws_1']),
    ).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([
    { error: new Error('fetch failed'), exitCode: 75, reason: 'fails transiently' },
    {
      error: Object.assign(new Error('forbidden'), { data: { code: 'FORBIDDEN' } }),
      exitCode: 1,
      reason: 'is refused by the server',
    },
  ])('exits with $exitCode when workspace registration $reason', async ({ error, exitCode }) => {
    mintWorkspaceConnectTokenMock.mockResolvedValueOnce({ token: 'workspace-token' });
    registerWorkspaceDeviceMock.mockRejectedValueOnce(error);
    exitSpy.mockImplementation(() => {
      throw new Error('process.exit');
    });

    await expect(
      createProgram().parseAsync([
        'node',
        'test',
        'connect',
        '--service-child',
        '--workspace',
        'ws_1',
      ]),
    ).rejects.toThrow('process.exit');

    expect(registerWorkspaceDeviceMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(exitCode);
    expect(connectCalled).toBe(false);
  });

  describe('workspace shares', () => {
    const connect = (...args: string[]) =>
      createProgram().parseAsync(['node', 'test', 'connect', ...args]);

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

    it('drains the worktree cleanups of a workspace share in its own workspace', async () => {
      vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
      getGlobalConfig.mockResolvedValue({
        serverConfig: { deviceGatewayUrl: 'https://gw.example.com' },
      });
      await connect();
      await clientEventHandlers['rpc_request']?.({
        method: 'enrollWorkspace',
        params: { token: 'ws-token', workspaceId: 'ws-1' },
        requestId: 'rpc-1',
        type: 'rpc_request',
      });
      createLambdaClientMock.mockClear();
      drainWorktreeCleanups.mockClear();

      // `clientEventHandlers` now belongs to the share connection.
      clientEventHandlers.connected?.();

      expect(createLambdaClientMock).toHaveBeenCalledWith(expect.anything(), 'ws-1');
      expect(drainWorktreeCleanups).toHaveBeenCalledWith({ deviceId: 'mock-device-id' });
    });

    it('refreshes the workspace row platform when restoring a persisted share', async () => {
      const wsIdentity = resolveWorkspaceDeviceIdentity('ws-1', undefined, 'test-connection-id');
      vi.mocked(loadWorkspaceEnrollments).mockReturnValueOnce(['ws-1']);
      createLambdaClientMock.mockReturnValueOnce({
        device: {
          drainWorktreeCleanups: { mutate: drainWorktreeCleanups },
          listDevices: {
            query: vi.fn().mockResolvedValue([{ deviceId: wsIdentity.deviceId, registered: true }]),
          },
        },
      });
      mintWorkspaceConnectTokenMock.mockResolvedValueOnce({
        token: 'ws-token',
        workspaceId: 'ws-1',
      });
      registerWorkspaceDeviceMock.mockResolvedValueOnce(undefined);

      await connect();

      await vi.waitFor(() =>
        expect(clientOptions).toMatchObject({ token: 'ws-token', workspaceId: 'ws-1' }),
      );
      expect(registerWorkspaceDeviceMock).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'test-token' }),
        wsIdentity,
        'ws-1',
      );
    });
  });
});
