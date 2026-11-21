import type * as DeviceControlModule from '@lobechat/device-control';
import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveToken } from '../auth/resolveToken';
import { appendLog } from '../daemon/manager';
import type * as DeviceRegister from '../device/register';
import type * as SystemInfoModule from '../device/systemInfo';
import { loadWorkspaceEnrollments, saveDeviceGatewayUrl } from '../settings';
import { executeToolCall } from '../tools';
import { log } from '../utils/logger';
import { registerConnectCommand } from './connect';

vi.mock('../service/status', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readConnectServices: async () => ({ services: [], unavailableScopes: [] }),
}));

vi.mock('../device/systemInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof SystemInfoModule>()),
  probeNativeRuntimes: vi.fn().mockResolvedValue([]),
}));

const registerDeviceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../device/register', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceRegister>()),
  registerDevice: registerDeviceMock,
  registerWorkspaceDevice: registerDeviceMock,
}));

vi.mock('../auth/resolveToken', () => ({ resolveToken: vi.fn() }));
vi.mock('../settings', () => ({
  addWorkspaceEnrollment: vi.fn(),
  loadDeviceGatewayUrl: vi.fn(),
  loadOrCreateConnectionId: vi.fn().mockReturnValue('test-connection-id'),
  loadSettings: vi.fn().mockReturnValue(null),
  loadWorkspaceEnrollments: vi.fn().mockReturnValue(['ws-stale']),
  normalizeUrl: vi.fn((url?: string) => (url ? url.replace(/\/$/, '') : undefined)),
  removeWorkspaceEnrollment: vi.fn(),
  resolveDeviceMetricsBacklogPath: vi.fn((id: string) => `/tmp/device-metrics/${id}.json`),
  saveDeviceGatewayUrl: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('../tools/shell', () => ({
  cleanupAllProcesses: vi.fn(),
  getActiveShellCount: vi.fn(() => 0),
}));

vi.mock('../daemon/manager', () => ({
  appendLog: vi.fn(),
  getLogPath: vi.fn().mockReturnValue('/tmp/test-daemon.log'),
  getRunningDaemonPid: vi.fn().mockReturnValue(null),
  isProcessAlive: vi.fn(() => false),
  readStatus: vi.fn(),
  removePid: vi.fn(),
  removeStatus: vi.fn(),
  reportDaemonStartupReady: vi.fn().mockResolvedValue(undefined),
  spawnDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  stopDaemonAndWait: vi.fn(),
  writeStatus: vi.fn(),
}));

vi.mock('../tools', () => ({
  executeToolCall: vi.fn().mockResolvedValue({ content: 'tool result', success: true }),
}));

const activity = vi.hoisted(() => ({
  begin: vi.fn(),
  end: vi.fn(),
  options: undefined as any,
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../device/activityHook', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ActivityReporter: vi.fn().mockImplementation(function (opts: any) {
    activity.options = opts;
    activity.begin.mockImplementation(() => activity.end);
    return activity;
  }),
}));

vi.mock('@lobechat/device-control', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceControlModule>()),
  DeviceMetricsSampler: vi.fn().mockImplementation(function () {
    return {
      flush: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

let handlers: Record<string, (...args: any[]) => any> = {};
let clientOptions: any;
let client: any;
const GatewayClientMock = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayClient: GatewayClientMock,
}));

const jwt = (payload: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const PERSONAL_TOKEN = jwt({ device_id: 'managed-1', purpose: 'managed-device', sub: 'user-1' });
const WORKSPACE_TOKEN = jwt({
  device_id: 'managed-1',
  purpose: 'managed-device',
  sub: 'ws-1',
  workspace_id: 'ws-1',
});

const MANAGED_ENV = {
  LOBEHUB_DEVICE_GATEWAY_URL: 'https://gateway.example.com',
  LOBEHUB_MANAGED_DEVICE_ID: 'managed-1',
  LOBEHUB_MANAGED_DEVICE_SECRET: 'top-secret',
  LOBEHUB_SERVER: 'https://app.example.com',
};

const tokenResponse = (token: string, lifetimeMs = 3_600_000) =>
  Response.json({ expiresAt: new Date(Date.now() + lifetimeMs).toISOString(), token });

describe('connect --managed', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let savedEnv: NodeJS.ProcessEnv;
  let signalListeners: Map<NodeJS.Signals, Set<(...args: unknown[]) => void>>;

  beforeEach(() => {
    signalListeners = new Map(
      (['SIGINT', 'SIGTERM'] as const).map((signal) => [
        signal,
        new Set(process.listeners(signal)),
      ]),
    );
    savedEnv = { ...process.env };
    Object.assign(process.env, MANAGED_ENV);
    delete process.env.LOBEHUB_DEVICE_ACTIVITY_COMMAND;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.spyOn(log, 'error').mockImplementation(() => {});
    vi.spyOn(log, 'info').mockImplementation(() => {});
    fetchMock = vi.fn(async () => tokenResponse(PERSONAL_TOKEN));
    vi.stubGlobal('fetch', fetchMock);
    clientOptions = undefined;
    GatewayClientMock.mockImplementation(function (opts: any) {
      clientOptions = opts;
      handlers = {};
      client = {
        activeTunnelCount: 0,
        connect: vi.fn().mockResolvedValue(undefined),
        connectionStatus: 'connecting',
        currentDeviceId: opts.deviceId,
        disconnect: vi.fn(),
        on: vi.fn((event: string, handler: (...args: any[]) => any) => {
          handlers[event] = handler;
        }),
        reconnect: vi.fn().mockResolvedValue(undefined),
        reportMetrics: vi.fn(),
        sendAgentRunAck: vi.fn(),
        sendRpcResponse: vi.fn(),
        sendSystemInfoResponse: vi.fn(),
        sendToolCallResponse: vi.fn(),
        updateToken: vi.fn(),
      };
      return client;
    });
  });

  afterEach(() => {
    for (const [signal, existing] of signalListeners) {
      for (const listener of process.listeners(signal)) {
        if (!existing.has(listener)) process.removeListener(signal, listener);
      }
    }
    process.env = savedEnv;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerConnectCommand(program);
    await program.parseAsync(['node', 'test', 'connect', '--managed', ...args]).catch(() => {});
  };

  it('connects as the managed device without the stored login', async () => {
    await run();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/device/managed/token',
      expect.objectContaining({
        body: JSON.stringify({ deviceId: 'managed-1', secret: 'top-secret' }),
        method: 'POST',
      }),
    );
    expect(clientOptions).toMatchObject({
      deviceId: 'managed-1',
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://app.example.com',
      token: PERSONAL_TOKEN,
      tokenType: 'jwt',
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(client.connect).toHaveBeenCalled();
    expect(resolveToken).not.toHaveBeenCalled();
    // The platform owns the row; the device never registers or restores shares.
    expect(registerDeviceMock).not.toHaveBeenCalled();
    expect(loadWorkspaceEnrollments).not.toHaveBeenCalled();
    expect(saveDeviceGatewayUrl).not.toHaveBeenCalled();
    // Child processes (tools, agents) must not inherit the bootstrap secret.
    expect(process.env.LOBEHUB_MANAGED_DEVICE_SECRET).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('uses the workspace principal when the token carries workspace_id', async () => {
    fetchMock.mockResolvedValue(tokenResponse(WORKSPACE_TOKEN));
    await run();

    expect(clientOptions).toMatchObject({ userId: undefined, workspaceId: 'ws-1' });
  });

  it('fails fast, naming the missing variables but not the secret', async () => {
    delete process.env.LOBEHUB_DEVICE_GATEWAY_URL;
    await run();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('LOBEHUB_DEVICE_GATEWAY_URL'));
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('top-secret');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(GatewayClientMock).not.toHaveBeenCalled();
  });

  it.each([['--token', 'x'], ['--workspace', 'ws-1'], ['--device-id', 'd'], ['--daemon']])(
    'rejects %s',
    async (...flag) => {
      await run(...flag);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining(flag[0]));
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('exits 1 on a 401 so the platform restarts it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await run();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
    expect(GatewayClientMock).not.toHaveBeenCalled();
  });

  it('exits 1 on a 404 (the server has no managed cloud devices)', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    await run();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'));
    expect(GatewayClientMock).not.toHaveBeenCalled();
  });

  it('never hands the gateway token to tools as a server API credential', async () => {
    await run();

    await handlers.tool_call_request({
      requestId: 'r1',
      toolCall: { apiName: 'readLocalFile', arguments: '{}', identifier: 'test' },
      type: 'tool_call_request',
    });
    expect(executeToolCall).toHaveBeenCalledWith('readLocalFile', '{}', undefined, undefined);
  });

  it('keeps retrying 5xx and network errors before connecting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(tokenResponse(PERSONAL_TOKEN));

    const running = run();
    await vi.advanceTimersByTimeAsync(60_000);
    await running;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalled();
  });

  it('refreshes at 80% of the lifetime without dropping the socket', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const refreshed = jwt({ sub: 'user-1', v: 2 });
    fetchMock
      .mockResolvedValueOnce(tokenResponse(PERSONAL_TOKEN, 100_000))
      .mockResolvedValueOnce(tokenResponse(refreshed, 100_000));
    await run();

    await vi.advanceTimersByTimeAsync(79_999);
    expect(client.updateToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.updateToken).toHaveBeenCalledWith(refreshed);
    // The next (re)connection authenticates with it; in-flight work keeps the socket.
    expect(client.reconnect).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('exits 1 when a scheduled refresh gets a 401', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fetchMock
      .mockResolvedValueOnce(tokenResponse(PERSONAL_TOKEN, 100_000))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await run();

    await vi.advanceTimersByTimeAsync(80_000);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('gets a new token once when the gateway rejects one, then gives up', async () => {
    const refreshed = jwt({ sub: 'user-1', v: 2 });
    fetchMock
      .mockResolvedValueOnce(tokenResponse(PERSONAL_TOKEN))
      .mockResolvedValueOnce(tokenResponse(refreshed));
    await run();

    await handlers.auth_failed('token rejected');
    expect(client.updateToken).toHaveBeenCalledWith(refreshed);
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    await handlers.auth_failed('token rejected');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('retries a rejected token again after a successful connection', async () => {
    await run();

    await handlers.auth_failed('token rejected');
    handlers.connected();
    await handlers.auth_failed('token rejected');
    expect(client.reconnect).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('gets a new token and reconnects when the gateway expires the token', async () => {
    const refreshed = jwt({ sub: 'user-1', v: 2 });
    fetchMock
      .mockResolvedValueOnce(tokenResponse(PERSONAL_TOKEN))
      .mockResolvedValueOnce(tokenResponse(refreshed));
    await run();

    await handlers.auth_expired();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.updateToken).toHaveBeenCalledWith(refreshed);
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits 1 when the token exchange refuses the device after the gateway expires the token', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse(PERSONAL_TOKEN))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await run();

    await handlers.auth_expired();
    expect(client.reconnect).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('reports tool calls, RPCs and agent dispatch through the activity hook', async () => {
    process.env.LOBEHUB_DEVICE_ACTIVITY_COMMAND = '["my-agent","touch"]';
    await run();

    expect(activity.options.command).toEqual(['my-agent', 'touch']);
    expect(activity.start).toHaveBeenCalled();

    await handlers.tool_call_request({
      requestId: 'r1',
      toolCall: { apiName: 'readLocalFile', arguments: '{}', identifier: 'test' },
      type: 'tool_call_request',
    });
    await handlers.rpc_request({ method: 'unknownMethod', params: {}, requestId: 'r2' });
    expect(activity.begin).toHaveBeenCalledTimes(2);
    expect(activity.end).toHaveBeenCalledTimes(2);

    // Polled work: open tunnels count as busy.
    expect(activity.options.isBusy()).toBe(false);
    client.activeTunnelCount = 1;
    expect(activity.options.isBusy()).toBe(true);
  });

  it('does not create an activity hook without the variable', async () => {
    await run();
    expect(activity.start).not.toHaveBeenCalled();
    expect(appendLog).not.toHaveBeenCalled();
  });
});
