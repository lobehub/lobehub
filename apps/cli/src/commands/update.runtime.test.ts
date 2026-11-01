import type * as ChildProcessModule from 'node:child_process';
import { EventEmitter } from 'node:events';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerUpdateCommand } from './update';

const state = vi.hoisted(() => ({
  latest: '0.0.71',
  pid: 4567,
  version: '0.0.65' as string | undefined,
}));
const spawn = vi.hoisted(() => vi.fn());

vi.mock('../pkg', () => ({ cliPackageName: '@lobehub/cli', cliVersion: '0.0.71' }));
vi.mock('../daemon/manager', () => ({
  getRunningDaemonPid: () => null,
  readStatus: () => ({
    cliVersion: state.version,
    connectionStatus: 'connected',
    gatewayUrl: 'wss://gateway.test',
    pid: state.pid,
    startedAt: '2026-10-26T00:00:00.000Z',
  }),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  execFile: vi.fn((_command, args, _options, callback) =>
    callback(
      null,
      args.includes('--system')
        ? 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=4567\nUser=ubuntu\nUnitFileState=enabled\nFragmentPath=/etc/systemd/system/lobehub-connect.service'
        : 'LoadState=not-found',
    ),
  ),
  spawn,
}));

describe('update with a running connector', () => {
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ version: state.latest }),
        ok: true,
      }),
    );
    state.version = '0.0.65';
    state.latest = '0.0.71';
    state.pid = 4567;
    spawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports an old running version even when the installed CLI is already current', async () => {
    const program = new Command();
    registerUpdateCommand(program);
    await program.parseAsync(['node', 'test', 'update']);

    const output = [...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls]
      .flat()
      .join('\n');
    expect(output).toContain('0.0.65');
    expect(output).toContain('0.0.71');
    expect(output).toContain('sudo systemctl --no-block restart lobehub-connect.service');
    expect(output).toContain('tasks');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not substitute the installed version for an unreported legacy runtime version', async () => {
    state.version = undefined;
    const program = new Command();
    registerUpdateCommand(program);
    await program.parseAsync(['node', 'test', 'update', '--check']);

    const output = [...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls]
      .flat()
      .join('\n');
    expect(output).toContain('unknown');
    expect(output).toContain('sudo systemctl --no-block restart lobehub-connect.service');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not attribute a different process status to the service', async () => {
    state.pid = 9999;
    const program = new Command();
    registerUpdateCommand(program);
    await program.parseAsync(['node', 'test', 'update']);
    const output = vi.mocked(log.info).mock.calls.flat().join('\n');
    expect(output).toContain('unknown');
    expect(output).not.toContain('0.0.65');
    expect(output).not.toContain('connected');
  });

  it('does not ask to restart a connector already reporting the installed version', async () => {
    state.version = '0.0.71';
    const program = new Command();
    registerUpdateCommand(program);
    await program.parseAsync(['node', 'test', 'update']);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('reports installed and running versions separately after installation without restarting', async () => {
    state.latest = '0.0.72';
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    const program = new Command();
    registerUpdateCommand(program);
    await program.parseAsync(['node', 'test', 'update', '--package-manager', 'npm']);

    const output = [...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls]
      .flat()
      .join('\n');
    expect(output).toContain('Successfully installed CLI 0.0.72');
    expect(output).toContain('running 0.0.65; installed CLI is 0.0.72');
    expect(output).toContain('sudo systemctl --no-block restart lobehub-connect.service');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0].slice(0, 2)).toEqual([
      'npm',
      ['install', '-g', '@lobehub/cli@0.0.72'],
    ]);
  });
});
