import type * as DeviceControlModule from '@lobechat/device-control';
import { GatewayClient } from '@lobechat/device-gateway-client';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';
import { resolveToken } from '../auth/resolveToken';
import type * as DeviceRegister from '../device/register';
import { registerConnectCommand } from './connect';

const codexProbe = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn<() => Promise<{ userAgent: string }>>(),
  options: vi.fn(),
  resolve: vi.fn<() => Promise<{ command: string; pathEnv?: string }>>(),
}));
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: codexProbe.resolve,
}));
vi.mock('@lobechat/heterogeneous-agents/spawn', () => ({
  CodexAppServerClient: class {
    constructor(options: object) {
      codexProbe.options(options);
    }
    close = codexProbe.close;
    connect = codexProbe.connect;
  },
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
  loadOrCreateConnectionId: vi.fn().mockReturnValue('test-connection-id'),
  loadSettings: vi.fn().mockReturnValue(null),
  // Default: no persisted workspace shares, so runConnect skips the restore path.
  loadWorkspaceEnrollments: vi.fn().mockReturnValue([]),
  normalizeUrl: vi.fn((url?: string) => (url ? url.replace(/\/$/, '') : undefined)),
  removeWorkspaceEnrollment: vi.fn(),
  resolveDeviceMetricsBacklogPath: vi.fn((id: string) => `/tmp/device-metrics/${id}.json`),
  saveSettings: vi.fn(),
}));

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

vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayClient: vi.fn().mockImplementation(function () {
    clientEventHandlers = {};
    lastSentSystemInfoResponse = null;
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      currentDeviceId: 'mock-device-id',
      disconnect: vi.fn(),
      on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        clientEventHandlers[event] = handler;
      }),
      reconnect: vi.fn().mockResolvedValue(undefined),
      reportMetrics: clientReportMetrics,
      sendSystemInfoResponse: vi.fn().mockImplementation((data: any) => {
        lastSentSystemInfoResponse = data;
      }),
      sendToolCallResponse: vi.fn(),
      updateToken: vi.fn(),
    };
  }),
}));

describe('connect native agent runtimes', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let signalListeners: Map<NodeJS.Signals, Set<(...args: unknown[]) => void>>;

  beforeEach(() => {
    codexProbe.connect.mockResolvedValue({ userAgent: 'codex/0.160.0' });
    codexProbe.resolve.mockResolvedValue({ command: '/resolved/codex', pathEnv: '/resolved/bin' });
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

  /** @example Desktop can inspect its bundled runtime without registering a device. */
  it('reports native capabilities without authenticating or connecting', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createProgram().parseAsync(['node', 'test', 'connect', 'capabilities']);
    /** @example Only a successful native handshake is advertised in machine-readable output. */
    expect(output).toHaveBeenCalledWith(
      JSON.stringify({ supportedAgentRuntimes: ['codex-app-server-v1'] }),
    );
    /** @example Capability discovery does not consume a user login or gateway connection. */
    expect(resolveToken).not.toHaveBeenCalled();
    expect(GatewayClient).not.toHaveBeenCalled();
    expect(codexProbe.close).toHaveBeenCalledOnce();
  });

  // ROOT CAUSE:
  // Every system_info_request started a Codex app-server handshake (up to 6 s), and tool
  // runs query system info during ordinary turns, so every device run paid for it.
  /** @example Repeated system info requests reuse one native probe per connection. */
  it('probes native Codex once per connection', async () => {
    await createProgram().parseAsync(['node', 'test', 'connect']);
    for (const requestId of ['probe-1', 'probe-2', 'probe-3']) {
      await clientEventHandlers['system_info_request']?.({
        requestId,
        type: 'system_info_request',
      });
    }
    /** @example Resolution PATH is carried into the exact probed executable. */
    expect(codexProbe.options).toHaveBeenCalledWith(
      expect.objectContaining({
        commandPath: '/resolved/codex',
        env: expect.objectContaining({ PATH: '/resolved/bin' }),
      }),
    );
    expect(codexProbe.connect).toHaveBeenCalledOnce();
    expect(lastSentSystemInfoResponse.result.systemInfo.supportedAgentRuntimes).toEqual([
      'codex-app-server-v1',
    ]);
  });

  /** @example Reconnecting detects a binary downgrade instead of keeping stale support. */
  it('reprobes native Codex when the gateway connection is re-established', async () => {
    await createProgram().parseAsync(['node', 'test', 'connect']);
    await clientEventHandlers['system_info_request']?.({
      requestId: 'probe-new',
      type: 'system_info_request',
    });
    codexProbe.connect.mockRejectedValueOnce(new Error('binary downgraded'));
    clientEventHandlers['connected']?.();
    await clientEventHandlers['system_info_request']?.({
      requestId: 'probe-downgrade',
      type: 'system_info_request',
    });
    /** @example A later unsupported binary revokes the previous capability. */
    expect(lastSentSystemInfoResponse.result.systemInfo.supportedAgentRuntimes).toEqual([]);
    expect(codexProbe.connect).toHaveBeenCalledTimes(2);
  });
});
