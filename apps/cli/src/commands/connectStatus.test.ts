import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectRuntime } from '../daemon/connectStatus';
import { readConnectRuntimes } from '../daemon/connectStatus';
import { cliVersion } from '../pkg';
import { log } from '../utils/logger';
import { describeStaleConnector, warnStaleConnectors } from './connectStatus';

vi.mock('../daemon/connectStatus', () => ({ readConnectRuntimes: vi.fn() }));

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

describe('stale connector warnings', () => {
  afterEach(() => vi.clearAllMocks());

  it('says nothing when the connector runs the installed version or is not running', () => {
    expect(describeStaleConnector(runtime('1.2.3'), '1.2.3')).toEqual([]);
    expect(describeStaleConnector(runtime(undefined, null), '1.2.3')).toEqual([]);
  });

  it('names the running version and the restart command after an update', () => {
    const lines = describeStaleConnector(runtime('1.2.2'), '1.2.3');
    expect(lines[0]).toBe('Connector PID 42 is running 1.2.2; installed CLI is 1.2.3.');
    expect(lines[1]).toContain('sudo systemctl --no-block restart lobehub-connect.service');
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
