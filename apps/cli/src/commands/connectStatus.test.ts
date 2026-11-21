import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectRuntime } from '../daemon/connectStatus';
import { readConnectRuntimes } from '../daemon/connectStatus';
import { getCliInstallationPath, getConnectorInstallationPath } from '../daemon/installation';
import { cliVersion } from '../pkg';
import { log } from '../utils/logger';
import { describeStaleConnector, printConnectStatus, warnStaleConnectors } from './connectStatus';

vi.mock('../daemon/connectStatus', () => ({ readConnectRuntimes: vi.fn() }));
vi.mock('../daemon/installation', () => ({
  getCliInstallationPath: vi.fn().mockResolvedValue('/opt/cli/dist/index.js'),
  getConnectorInstallationPath: vi.fn().mockResolvedValue('/opt/cli/dist/index.js'),
}));

const runtime = (cliVersionReported?: string, pid: number | null = 42): ConnectRuntime => ({
  manager: 'system',
  pid,
  restartCommand: 'sudo systemctl --no-block restart lobehub-connect.service',
  status: {
    cliVersion: cliVersionReported,
    connectionStatus: 'connected',
    gatewayUrl: 'wss://gw',
    pid: 42,
    startedAt: '',
  },
});

const systemServiceRuntime = (): ConnectRuntime => ({
  ...runtime(cliVersion),
  service: {
    active: true,
    enabled: true,
    fragmentPath: '/etc/systemd/system/lobehub-connect.service',
    mainPid: 42,
    restart: 'always',
    restartPreventExitStatus: [],
    scope: 'system',
    serviceName: 'lobehub-connect.service',
    subState: 'running',
    successExitStatus: [],
    user: 'ubuntu',
  },
});

describe('service inspection messages', () => {
  afterEach(() => vi.clearAllMocks());

  it.each([false, true])(
    'reports unavailable user services as info when a system service is connected (servicesOnly=%s)',
    async (servicesOnly) => {
      vi.mocked(readConnectRuntimes).mockResolvedValue({
        runtimes: [systemServiceRuntime()],
        unavailableScopes: ['user'],
      });

      await printConnectStatus({ servicesOnly, verbose: true });

      expect(log.warn).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(
        'User-level systemd inspection is unavailable. The system-level connect service is running and connected; this does not affect its connection.',
      );
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Running version'));
      expect(log.info).toHaveBeenCalledWith(
        "Check 'systemctl --user status' to diagnose user-level systemd access.",
      );
    },
  );

  it.each(['missing', 'inactive', 'no-pid', 'disconnected', 'unknown', 'daemon'])(
    'keeps the warning when the system service is %s',
    async (state) => {
      const connected = systemServiceRuntime();
      if (state === 'inactive') connected.service!.active = false;
      if (state === 'no-pid') connected.pid = null;
      if (state === 'disconnected') connected.status!.connectionStatus = 'disconnected';
      if (state === 'unknown') connected.status = undefined;
      if (state === 'daemon') {
        connected.manager = 'daemon';
        connected.service = undefined;
      }
      vi.mocked(readConnectRuntimes).mockResolvedValue({
        runtimes: state === 'missing' ? [] : [connected],
        unavailableScopes: ['user'],
      });

      await printConnectStatus();

      expect(log.warn).toHaveBeenCalledWith(
        "Could not inspect user systemd services. Check 'systemctl --user status'.",
      );
      expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('does not affect'));
    },
  );

  it('keeps the healthy default output compact and puts optional inspection details behind verbose', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [systemServiceRuntime()],
      unavailableScopes: ['user'],
    });
    await printConnectStatus();
    const output = vi.mocked(log.info).mock.calls.flat().join('\n');
    expect(output).toContain('matches installed CLI');
    expect(output).toContain('connected');
    expect(output).toContain('lh connect status --verbose');
    for (const detail of [
      'inspection is unavailable',
      'PID',
      'Unit',
      'Gateway',
      'Uptime',
      'CLI path',
    ]) {
      expect(output).not.toContain(detail);
    }
    expect(getCliInstallationPath).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('diagnoses multiple installations without hiding a stale version', async () => {
    const connected = systemServiceRuntime();
    connected.status!.cliVersion = '0.0.0-old';
    vi.mocked(getConnectorInstallationPath).mockResolvedValueOnce('/other/cli/dist/index.js');
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [connected],
      unavailableScopes: [],
    });
    await printConnectStatus();
    const output = vi.mocked(log.info).mock.calls.flat().join('\n');
    expect(output).toContain('/opt/cli/dist/index.js');
    expect(output).toContain('/other/cli/dist/index.js');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Different CLI installations'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('running 0.0.0-old'));
  });

  it('keeps warnings when both systemd managers are unavailable', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [],
      unavailableScopes: ['user', 'system'],
    });

    await printConnectStatus();

    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      "Could not inspect system systemd services. Check 'systemctl --system status'.",
    );
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('service status is incomplete'));
  });

  it('still warns about an outdated connected system service', async () => {
    const connected = systemServiceRuntime();
    connected.status!.cliVersion = '0.0.0-old';
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [connected],
      unavailableScopes: ['user'],
    });

    await printConnectStatus();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('running 0.0.0-old'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Could not inspect'));
  });
});

describe('stale connector warnings', () => {
  afterEach(() => vi.clearAllMocks());

  it('says nothing when the connector runs the installed version or is not running', () => {
    expect(describeStaleConnector(runtime('1.2.3'), '1.2.3')).toEqual([]);
    expect(describeStaleConnector(runtime(undefined, null), '1.2.3')).toEqual([]);
  });

  it('names the running version and the restart command after an update', () => {
    const lines = describeStaleConnector(runtime('1.2.2'), '1.2.3');
    expect(lines[0]).toBe('Connector PID 42 is running 1.2.2; installed CLI is 1.2.3.');
    expect(lines[1]).toContain('lh connect restart --manager system');
  });

  it('does not treat a connector from before version reporting as current', () => {
    expect(describeStaleConnector(runtime(undefined), '1.2.3')[0]).toContain(
      'did not report its version',
    );
  });

  it('warns only for connectors that differ from this CLI', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [runtime(cliVersion), runtime(undefined)],
      unavailableScopes: [],
    });

    await warnStaleConnectors();

    expect(log.warn).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('did not report its version'));
    expect(log.info).not.toHaveBeenCalled();
  });
});
