import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const makeChild = (lines: string[], code = 0) => {
  const stdout = new PassThrough();
  const child = {
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;
    }),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'close') {
        stdout.write(lines.join('\n') + '\n');
        stdout.end();
        setImmediate(() => handler(code, null));
      }
      return child;
    }),
    removeAllListeners: vi.fn(),
    stdout,
  } as unknown as ChildProcessWithoutNullStreams;

  return child;
};

describe('projectFileSearchManager.collectNonGitFilePaths', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('spawns the finder without a console window on Windows', async () => {
    spawnMock.mockImplementation(() => makeChild(['src/Button.tsx']));

    const { projectFileSearchManager } = await import('../projectFileSearchManager');
    const files = await projectFileSearchManager.collectNonGitFilePaths('/tmp/fake-scope');

    expect(files).toHaveLength(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });
});

describe('defaultSearchProjectFiles git path', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete (execFileMock as Record<symbol, unknown>)[promisify.custom];
  });

  it('runs every git child process without a console window on Windows', async () => {
    // Mirror Node's own `promisify.custom` on execFile so the module's
    // `promisify(execFile)` resolves with `{ stdout, stderr }`.
    const execCalls: { args: string[]; options: unknown }[] = [];
    (execFileMock as Record<symbol, unknown>)[promisify.custom] = (
      _file: string,
      args: string[],
      options: unknown,
    ) => {
      execCalls.push({ args, options });
      const stdout = args.includes('rev-parse')
        ? '/tmp/fake-scope\n'
        : 'src/Button.tsx\nsrc/components/Input.tsx\n';
      return Promise.resolve({ stderr: '', stdout });
    };

    const { defaultSearchProjectFiles } = await import('../projectFileIndex');
    const result = await defaultSearchProjectFiles({ query: 'button', scope: '/tmp/fake-scope' });

    expect(result.source).toBe('git');
    expect(execCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of execCalls) {
      expect(call.options).toMatchObject({ windowsHide: true });
    }
  });
});
