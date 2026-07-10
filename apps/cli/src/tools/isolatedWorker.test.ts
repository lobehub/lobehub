import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('executeToolCallInWorker', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should prefer stderr over stdout when reporting worker failure output', async () => {
    spawnMock.mockImplementation(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = {
        kill: vi.fn(),
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === 'close') {
            stdout.write('worker stdout');
            stderr.write('worker stderr');
            stdout.end();
            stderr.end();
            setImmediate(() => handler(1, null));
          }
          return child;
        }),
        stderr,
        stdout,
      } as unknown as ChildProcessWithoutNullStreams;

      return child;
    });

    const { executeToolCallInWorker } = await import('./isolatedWorker');
    const result = await executeToolCallInWorker('searchFiles', '{"keywords":""}');

    expect(result).toEqual({
      content: 'Isolated tool worker failed for searchFiles with exit code 1: worker stderr',
      state: { failureType: 'worker_exit', success: false },
      success: true,
    });
  });

  it('should use No Output when worker exits without stdout or stderr', async () => {
    spawnMock.mockImplementation(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = {
        kill: vi.fn(),
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === 'close') {
            stdout.end();
            stderr.end();
            setImmediate(() => handler(1, null));
          }
          return child;
        }),
        stderr,
        stdout,
      } as unknown as ChildProcessWithoutNullStreams;

      return child;
    });

    const { executeToolCallInWorker } = await import('./isolatedWorker');
    const result = await executeToolCallInWorker('globFiles', '{"pattern":"*.ts"}');

    expect(result).toEqual({
      content: 'Isolated tool worker failed for globFiles with exit code 1: No Output',
      state: { failureType: 'worker_exit', success: false },
      success: true,
    });
  });

  it('should report invalid JSON output from a successful worker exit', async () => {
    spawnMock.mockImplementation(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = {
        kill: vi.fn(),
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (event === 'close') {
            stdout.write('not-json');
            stdout.end();
            stderr.end();
            setImmediate(() => handler(0, null));
          }
          return child;
        }),
        stderr,
        stdout,
      } as unknown as ChildProcessWithoutNullStreams;

      return child;
    });

    const { executeToolCallInWorker } = await import('./isolatedWorker');
    const result = await executeToolCallInWorker('listFiles', '{"path":"/tmp"}');

    expect(result.success).toBe(true);
    expect(result.content).toContain('Isolated tool worker returned invalid JSON for listFiles:');
    expect(result.content).toContain('Output: not-json');
    expect(result.state).toEqual({ failureType: 'invalid_json', success: false });
  });

  it('should timeout and kill the worker when it exceeds the timeout', async () => {
    vi.useFakeTimers();

    const kill = vi.fn();
    spawnMock.mockImplementation(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = {
        kill,
        on: vi.fn(() => child),
        stderr,
        stdout,
      } as unknown as ChildProcessWithoutNullStreams;

      return child;
    });

    const { executeToolCallInWorker } = await import('./isolatedWorker');
    const resultPromise = executeToolCallInWorker('grepContent', '{"pattern":"hello"}', 1000);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({
      content: 'Isolated tool worker timed out for grepContent after 1000ms',
      state: { failureType: 'timeout', success: false, timeoutMs: 1000 },
      success: true,
    });
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });
});
