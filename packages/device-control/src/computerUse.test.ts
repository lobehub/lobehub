import { describe, expect, it, vi } from 'vitest';

import { normalizeAuvArgv, runAuvCommand, toAuvToolOutput } from './computerUse';

describe('normalizeAuvArgv', () => {
  it('adds --json to an invoke command', () => {
    expect(normalizeAuvArgv({ argv: ['invoke', 'display.capture'] })).toEqual([
      'invoke',
      'display.capture',
      '--json',
    ]);
  });

  it('leaves help requests as text', () => {
    expect(normalizeAuvArgv({ argv: ['invoke', '--help'] })).toEqual(['invoke', '--help']);
    expect(normalizeAuvArgv({ argv: ['invoke', 'display.capture', '-h'] })).toEqual([
      'invoke',
      'display.capture',
      '-h',
    ]);
  });

  it.each([
    [['serve', '--help'], 'Only "auv invoke" commands are allowed'],
    [['invoke'], 'AUV argv must include "invoke" and a command or --help'],
    [['invoke', 'display.capture', '--store-root', '/tmp/other'], 'managed by LobeHub'],
    [['invoke', 'display.capture', '--store-root=/tmp/other'], 'managed by LobeHub'],
    [['invoke', '; rm -rf /'], 'Invalid AUV invoke command'],
    [['invoke', 'display.capture', 'a\0b'], 'NUL bytes'],
  ])('rejects %j', (argv, message) => {
    expect(() => normalizeAuvArgv({ argv })).toThrow(message);
  });
});

describe('runAuvCommand', () => {
  it('parses JSON output and keeps the caller argv', async () => {
    const exec = vi.fn().mockResolvedValue({ stderr: '', stdout: '{"run_id":"run-1"}\n' });

    await expect(
      runAuvCommand(
        { argv: ['invoke', 'display.list'] },
        ['invoke', 'display.list', '--json'],
        exec,
      ),
    ).resolves.toEqual({
      argv: ['invoke', 'display.list'],
      exitCode: 0,
      output: { run_id: 'run-1' },
    });
    expect(exec).toHaveBeenCalledWith(['invoke', 'display.list', '--json']);
  });

  it('returns a nonzero exit as a result with its structured output', async () => {
    const exec = vi.fn().mockRejectedValue(
      Object.assign(new Error('exit 2'), {
        code: 2,
        stderr: 'window not found\n',
        stdout: '{"error":"window_not_found"}',
      }),
    );

    await expect(
      runAuvCommand({ argv: ['invoke', 'x.y'] }, ['invoke', 'x.y'], exec),
    ).resolves.toEqual({
      argv: ['invoke', 'x.y'],
      exitCode: 2,
      output: { error: 'window_not_found' },
      stderr: 'window not found',
    });
  });

  it('rethrows spawn failures and timeouts', async () => {
    const spawnFailure = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    await expect(
      runAuvCommand({ argv: ['invoke', 'x.y'] }, ['invoke', 'x.y'], () =>
        Promise.reject(spawnFailure),
      ),
    ).rejects.toBe(spawnFailure);

    const timeout = Object.assign(new Error('killed'), { code: 1, killed: true });
    await expect(
      runAuvCommand({ argv: ['invoke', 'x.y'] }, ['invoke', 'x.y'], () => Promise.reject(timeout)),
    ).rejects.toBe(timeout);
  });
});

describe('toAuvToolOutput', () => {
  it('marks a nonzero exit as a failed tool call and keeps the result as state', () => {
    const result = { argv: ['invoke', 'x.y'], exitCode: 3, output: null, stderr: 'boom' };

    expect(toAuvToolOutput(result)).toEqual({
      content: JSON.stringify(result),
      error: 'boom',
      state: result,
      success: false,
    });
  });
});
