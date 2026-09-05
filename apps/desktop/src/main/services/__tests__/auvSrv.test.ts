import type { AuvClient, AuvConnection, AuvDaemon } from '@auv-js/sdk/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import AuvService, { type AuvSdkRuntime } from '../auvSrv';

const localDevice = {
  id: 'device-local',
  labels: { 'auv.dev/platform': 'DEVICE_PLATFORM_MACOS' },
  local: true,
  name: '',
  platform: 'macos' as const,
};

const localRunnerClass = {
  available: true,
  deviceId: localDevice.id,
  displayName: 'auv.core.local',
  id: 'auv.core.local',
  supportedLifecycles: ['ephemeral', 'unless_idle', 'unless_shutdown'] as const,
};

function createHarness() {
  const connection = {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuvConnection;
  const daemon = {
    connect: vi.fn().mockResolvedValue(connection),
    connectionOptions: {
      endpoint: 'unix:///tmp/lobehub-auv.sock',
      local: true,
      transport: 'unix',
    },
    stop: vi.fn().mockResolvedValue({ code: 0, signal: null }),
  } as unknown as AuvDaemon;
  const client = {
    devices: { list: vi.fn().mockResolvedValue([localDevice]) },
    health: { check: vi.fn().mockResolvedValue('serving') },
    runners: {
      listClasses: vi.fn().mockResolvedValue([localRunnerClass]),
    },
  } as unknown as AuvClient;
  const sdk = {
    createAuv: vi.fn().mockReturnValue(client),
    startAuv: vi.fn().mockResolvedValue(daemon),
  } as unknown as AuvSdkRuntime;
  const app = {
    appStoragePath: '/tmp/lobehub-storage',
  } as unknown as App;
  const ipcCleanup = vi.fn().mockResolvedValue(undefined);
  const resolveBinaryPath = vi.fn().mockResolvedValue('/opt/lobehub/bin/auv');
  const runCli = vi.fn().mockResolvedValue({
    stderr: '',
    stdout: JSON.stringify({
      artifacts: [{ file_path: '/tmp/lobehub-storage/auv/runs/capture.png' }],
      command_id: 'display.capture',
      status: 'completed',
    }),
  });
  const service = new AuvService(app, {
    createIpcListener: vi.fn().mockResolvedValue({
      cleanup: ipcCleanup,
      listener: 'unix:///private/auv/session.sock',
    }),
    hostname: () => 'Nekos-MBP.lan',
    loadSdk: vi.fn().mockResolvedValue(sdk),
    resolveBinaryPath,
    runCli,
  });

  return { app, client, connection, daemon, ipcCleanup, resolveBinaryPath, runCli, sdk, service };
}

describe('AuvService', () => {
  beforeEach(() => {
    delete process.env.AUV_BINARY_PATH;
  });

  it('starts an app-owned daemon and exposes a serializable device inventory', async () => {
    const { client, daemon, resolveBinaryPath, sdk, service } = createHarness();

    const snapshot = await service.connect();

    expect(resolveBinaryPath).toHaveBeenCalledOnce();
    expect(sdk.startAuv).toHaveBeenCalledWith({
      binaryPath: '/opt/lobehub/bin/auv',
      listeners: ['unix:///private/auv/session.sock'],
      noDiscovery: true,
      storeRoot: '/tmp/lobehub-storage/auv/store',
    });
    expect(daemon.connect).toHaveBeenCalledOnce();
    expect(client.health.check).toHaveBeenCalledOnce();
    expect(client.runners.listClasses).toHaveBeenCalledWith();
    expect(snapshot).toEqual({
      devices: [
        {
          id: 'device-local',
          labels: { 'auv.dev/platform': 'DEVICE_PLATFORM_MACOS' },
          local: true,
          name: 'Nekos-MBP',
          platform: 'macos',
        },
      ],
      runnerClasses: [localRunnerClass],
      status: 'connected',
      transport: 'unix',
    });
  });

  it('rejects and stops a child that does not expose a local IPC transport', async () => {
    const { daemon, ipcCleanup, service } = createHarness();
    Object.assign(daemon.connectionOptions, {
      endpoint: 'http://127.0.0.1:19847',
      local: true,
      transport: 'http',
    });

    await expect(service.connect()).rejects.toThrow('AUV refused non-private transport: http');

    expect(daemon.connect).not.toHaveBeenCalled();
    expect(daemon.stop).toHaveBeenCalledOnce();
    expect(ipcCleanup).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toEqual({
      devices: [],
      error: 'AUV refused non-private transport: http',
      runnerClasses: [],
      status: 'error',
    });
  });

  it('closes partially-opened resources and records a failed connection', async () => {
    const { client, connection, daemon, ipcCleanup, service } = createHarness();
    vi.mocked(client.health.check).mockRejectedValueOnce(new Error('daemon is unavailable'));

    await expect(service.connect()).rejects.toThrow('daemon is unavailable');

    expect(connection.close).toHaveBeenCalledOnce();
    expect(daemon.stop).toHaveBeenCalledOnce();
    expect(ipcCleanup).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toEqual({
      devices: [],
      error: 'daemon is unavailable',
      runnerClasses: [],
      status: 'error',
    });
  });

  it('closes the SDK connection and embedded daemon on disconnect', async () => {
    const { connection, daemon, ipcCleanup, service } = createHarness();
    await service.connect();

    const snapshot = await service.disconnect();

    expect(connection.close).toHaveBeenCalledOnce();
    expect(daemon.stop).toHaveBeenCalledOnce();
    expect(ipcCleanup).toHaveBeenCalledOnce();
    expect(snapshot).toEqual({ devices: [], runnerClasses: [], status: 'disconnected' });
  });

  it('returns defensive copies of device metadata', async () => {
    const { service } = createHarness();
    const snapshot = await service.connect();

    snapshot.devices[0]!.labels.changed = 'yes';
    snapshot.devices.length = 0;

    expect(service.getSnapshot().devices).toEqual([
      expect.objectContaining({
        labels: { 'auv.dev/platform': 'DEVICE_PLATFORM_MACOS' },
        name: 'Nekos-MBP',
      }),
    ]);
  });

  it('runs a typed CLI command against the private endpoint and preserves image artifacts', async () => {
    const { runCli, service } = createHarness();

    const result = await service.runCommand({ argv: ['invoke', 'display.capture'] });

    expect(runCli).toHaveBeenCalledWith({
      argv: ['invoke', 'display.capture', '--json'],
      binaryPath: '/opt/lobehub/bin/auv',
      endpoint: 'unix:///private/auv/session.sock',
      storeRoot: '/tmp/lobehub-storage/auv/runs',
    });
    expect(result).toEqual({
      argv: ['invoke', 'display.capture'],
      output: {
        artifacts: [{ file_path: '/tmp/lobehub-storage/auv/runs/capture.png' }],
        command_id: 'display.capture',
        status: 'completed',
      },
    });
  });

  it('returns CLI help as text without forcing JSON output', async () => {
    const { runCli, service } = createHarness();
    runCli.mockResolvedValueOnce({ stderr: '', stdout: 'Usage: auv invoke <COMMAND>' });

    const result = await service.runCommand({ argv: ['invoke', '--help'] });

    expect(runCli).toHaveBeenCalledWith(expect.objectContaining({ argv: ['invoke', '--help'] }));
    expect(result.output).toBe('Usage: auv invoke <COMMAND>');
  });

  it.each([
    [{ argv: ['serve', '--help'] }, 'Only "auv invoke" commands are allowed'],
    [
      { argv: ['invoke', 'display.capture', '--store-root', '/tmp/other'] },
      'AUV --store-root is managed by LobeHub',
    ],
  ])('rejects unsafe CLI argv before starting AUV', async (params, message) => {
    const { runCli, sdk, service } = createHarness();

    await expect(service.runCommand(params)).rejects.toThrow(message);

    expect(sdk.startAuv).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });
});
