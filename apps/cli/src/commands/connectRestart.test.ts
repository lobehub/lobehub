import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ConnectRuntime, readConnectRuntimes } from '../daemon/connectStatus';
import { log } from '../utils/logger';
import { restartConnector } from './connectRestart';

vi.mock('../daemon/connectStatus', () => ({ readConnectRuntimes: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function service(scope: 'system' | 'user'): ConnectRuntime {
  return {
    manager: scope,
    pid: 42,
    restartCommand: `${scope === 'system' ? 'sudo systemctl' : 'systemctl --user'} --no-block restart lobehub-connect.service`,
    service: {
      active: true,
      enabled: true,
      fragmentPath: null,
      mainPid: 42,
      restart: 'always',
      restartPreventExitStatus: [],
      scope,
      serviceName: 'lobehub-connect.service',
      subState: 'running',
      successExitStatus: [],
      user: 'user',
    },
  };
}
const daemon: ConnectRuntime = { manager: 'daemon', pid: 84, restartCommand: 'lh connect restart' };
const restartDaemon = vi.fn().mockResolvedValue(undefined);
let exitCode: typeof process.exitCode;

beforeEach(() => {
  exitCode = process.exitCode;
  vi.spyOn(process, 'getuid').mockReturnValue(1000);
  vi.mocked(spawn).mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child as ReturnType<typeof spawn>;
  });
});
afterEach(() => {
  process.exitCode = exitCode;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('restartConnector', () => {
  it.each(['system', 'user'] as const)(
    'requests a nonblocking %s restart without starting a daemon',
    async (scope) => {
      vi.mocked(readConnectRuntimes).mockResolvedValue({
        runtimes: [service(scope)],
        unavailableScopes: scope === 'system' ? ['user'] : [],
      });
      await restartConnector({}, restartDaemon);
      expect(spawn).toHaveBeenCalledWith(
        scope === 'system' ? 'sudo' : 'systemctl',
        [
          ...(scope === 'system' ? ['systemctl', '--system'] : ['--user']),
          '--no-block',
          'restart',
          'lobehub-connect.service',
        ],
        { stdio: 'inherit' },
      );
      expect(restartDaemon).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('remote terminals'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Terminated'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Restart requested'));
      expect(vi.mocked(log.warn).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(spawn).mock.invocationCallOrder[0],
      );
    },
  );

  it('does not require sudo when already root', async () => {
    vi.mocked(process.getuid!).mockReturnValue(0);
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [service('system')],
      unavailableScopes: [],
    });
    await restartConnector({}, restartDaemon);
    expect(spawn).toHaveBeenCalledWith(
      'systemctl',
      ['--system', '--no-block', 'restart', 'lobehub-connect.service'],
      { stdio: 'inherit' },
    );
  });

  it('requires an explicit choice when multiple connectors are running', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [service('system'), service('user'), daemon],
      unavailableScopes: [],
    });
    await restartConnector({}, restartDaemon);
    expect(spawn).not.toHaveBeenCalled();
    expect(restartDaemon).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Multiple connectors'));
    await restartConnector({ manager: 'user' }, restartDaemon);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('prefers the active service over an inactive installation', async () => {
    const inactive = service('user');
    inactive.pid = null;
    inactive.service!.active = false;
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [inactive, service('system')],
      unavailableScopes: [],
    });
    await restartConnector({}, restartDaemon);
    expect(spawn).toHaveBeenCalledWith(
      'sudo',
      expect.arrayContaining(['--system']),
      expect.anything(),
    );
  });

  it('does not stop a selected daemon if a service would prevent its replacement', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [daemon, service('system')],
      unavailableScopes: [],
    });
    await restartConnector({ manager: 'daemon' }, restartDaemon);
    expect(process.exitCode).toBe(1);
    expect(restartDaemon).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No connector was stopped'));
  });

  it('warns before restarting a daemon', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({ runtimes: [daemon], unavailableScopes: [] });
    await restartConnector({}, restartDaemon);
    expect(restartDaemon).toHaveBeenCalledOnce();
    expect(vi.mocked(log.warn).mock.invocationCallOrder[0]).toBeLessThan(
      restartDaemon.mock.invocationCallOrder[0],
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('preserves restart-as-start when no connector exists', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({ runtimes: [], unavailableScopes: [] });
    await restartConnector({}, restartDaemon);
    expect(restartDaemon).toHaveBeenCalledOnce();
  });

  it.each(['user', 'system'] as const)(
    'does not start a competing daemon when %s inspection fails',
    async (scope) => {
      vi.mocked(readConnectRuntimes).mockResolvedValue({
        runtimes: [],
        unavailableScopes: [scope],
      });
      await restartConnector({}, restartDaemon);
      expect(process.exitCode).toBe(1);
      expect(restartDaemon).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each(['invalid', 'user'])(
    'rejects an invalid or missing explicit manager: %s',
    async (manager) => {
      vi.mocked(readConnectRuntimes).mockResolvedValue({
        runtimes: [service('system')],
        unavailableScopes: [],
      });
      await restartConnector({ manager }, restartDaemon);
      expect(process.exitCode).toBe(1);
      expect(spawn).not.toHaveBeenCalled();
      expect(restartDaemon).not.toHaveBeenCalled();
    },
  );

  it('does not silently ignore daemon options or expose their values for a service', async () => {
    vi.mocked(readConnectRuntimes).mockResolvedValue({
      runtimes: [service('system')],
      unavailableScopes: [],
    });
    await restartConnector({ token: 'private-token' }, restartDaemon);
    expect(spawn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('cannot override'));
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('private-token');
  });

  it.each(['error', 'nonzero'])(
    'does not report success after a failed restart request (%s)',
    async (failure) => {
      vi.mocked(readConnectRuntimes).mockResolvedValue({
        runtimes: [service('system')],
        unavailableScopes: [],
      });
      vi.mocked(spawn).mockImplementationOnce(() => {
        const child = new EventEmitter();
        queueMicrotask(() =>
          failure === 'error' ? child.emit('error', new Error('denied')) : child.emit('close', 1),
        );
        return child as ReturnType<typeof spawn>;
      });
      await restartConnector({}, restartDaemon);
      expect(process.exitCode).toBe(1);
      expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('Restart requested'));
      expect(restartDaemon).not.toHaveBeenCalled();
    },
  );
});
