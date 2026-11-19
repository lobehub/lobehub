import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { spawnAgent } from './spawnAgent';

const spawnCalls: Array<{ args: string[]; command: string }> = [];
let nextFakeProc: any = null;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[]) => {
      spawnCalls.push({ args, command });
      return nextFakeProc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

const platformMock = vi.mocked(os.platform);

const createProc = () => {
  const proc = new EventEmitter() as any;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.killed = false;
  proc.pid = 4242;
  return proc;
};

describe('spawnAgent kill on Windows', () => {
  afterEach(() => {
    platformMock.mockReturnValue('linux');
    spawnCalls.length = 0;
    nextFakeProc = null;
  });

  it('kills the whole process tree with taskkill, not just the direct child', async () => {
    const proc = createProc();
    nextFakeProc = proc;
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-win-tree',
      prompt: 'do a thing',
    });

    // A `.cmd` shim's node or Claude Code's Git Bash children would survive a
    // direct `proc.kill`, which on Windows terminates only that one process.
    platformMock.mockReturnValue('win32');
    nextFakeProc = new EventEmitter();
    handle.kill('SIGINT');

    expect(spawnCalls.at(-1)).toEqual({
      args: ['/pid', '4242', '/T', '/F'],
      command: 'taskkill',
    });
    expect(proc.kill).not.toHaveBeenCalled();

    proc.stdout.end();
    proc.stderr.end();
    proc.emit('exit', 1, null);
    for await (const _event of handle.events) {
      // drain
    }
  });

  it('falls back to a direct kill when taskkill cannot start', async () => {
    const proc = createProc();
    nextFakeProc = proc;
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-win-fallback',
      prompt: 'do a thing',
    });

    platformMock.mockReturnValue('win32');
    const killer = new EventEmitter();
    nextFakeProc = killer;
    handle.kill('SIGKILL');
    killer.emit('error', new Error('spawn taskkill ENOENT'));

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    proc.stdout.end();
    proc.stderr.end();
    proc.emit('exit', 1, null);
    for await (const _event of handle.events) {
      // drain
    }
  });
});
