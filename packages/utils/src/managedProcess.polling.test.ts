// @vitest-environment node
import type * as ChildProcessModule from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedProcessRegistry } from './managedProcess';

const { enumerate } = vi.hoisted(() => ({ enumerate: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const { promisify } = await import('node:util');
  return {
    ...(await importOriginal<typeof ChildProcessModule>()),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: enumerate }),
  };
});
vi.mock('node:fs/promises', () => ({ readdir: async () => [] }));

const platform = process.platform;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'win32' });
  enumerate.mockReset().mockResolvedValue({ stdout: '[]' });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: platform });
});

const start = () => {
  const registry = new ManagedProcessRegistry();
  registry.environment({ topicId: 'topic' });
  const child = { pid: 123, exitCode: 0 as number | null, signalCode: null };
  registry.register(child as ChildProcess, false, { topicId: 'topic' });
  return { registry, child };
};

describe('Windows process polling', () => {
  it('bounds idle discovery scans and stops when the reuse window expires', async () => {
    start();
    await vi.advanceTimersByTimeAsync(900000);
    expect(enumerate.mock.calls.length).toBeLessThanOrEqual(31);
    expect(enumerate).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.any(Object));
    await vi.advanceTimersByTimeAsync(30000);
    const scans = enumerate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(enumerate).toHaveBeenCalledTimes(scans);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off failures and expires unused scopes without successful enumeration', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    enumerate.mockRejectedValue(new Error('CIM unavailable'));
    start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(enumerate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(enumerate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(enumerate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1800000);
    expect(enumerate.mock.calls.length).toBeLessThan(22);
    expect(errors).toHaveBeenCalledTimes(enumerate.mock.calls.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes fast tracking for new work and allows immediate explicit snapshots', async () => {
    const { registry, child } = start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await registry.snapshot();
    expect(enumerate).toHaveBeenCalledTimes(2);
    child.exitCode = null;
    registry.register(child as ChildProcess, false, { topicId: 'topic' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(enumerate).toHaveBeenCalledTimes(5);
  });

  it('resets failure backoff after recovery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { child } = start();
    child.exitCode = null;
    enumerate.mockRejectedValueOnce(new Error('CIM unavailable'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(enumerate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(enumerate).toHaveBeenCalledTimes(4);
  });
});
