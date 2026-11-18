import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileParseJob } from './protocol';

// The event order "deadline passed, terminate() called, a message still arrives, then exit" cannot
// be produced deterministically with a real thread (terminate() usually drops the pending
// message). The real-thread behaviour is covered in runner.test.ts; this pins the ordering rule.
class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = [];
  /** Heap probe threads; `autoProbe = false` leaves them to the test to answer. */
  static probes: FakeWorker[] = [];
  static autoProbe = true;
  terminate = vi.fn(async () => 0);
  constructor(_source?: unknown, options?: { eval?: boolean; resourceLimits?: any }) {
    super();
    if (options?.eval) {
      // The runner's heap probe, not a parse worker: reports the limit its resourceLimits give.
      const { maxOldGenerationSizeMb, maxYoungGenerationSizeMb } = options.resourceLimits;
      FakeWorker.probes.push(this);
      if (FakeWorker.autoProbe) {
        queueMicrotask(() => {
          this.emit('message', (maxOldGenerationSizeMb + maxYoungGenerationSizeMb) * 1024 * 1024);
          this.emit('exit', 0);
        });
      }
      return;
    }
    FakeWorker.instances.push(this);
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  access: async () => {},
}));
// The worker is created once the (async) artifact check has passed.
const nextWorker = async () => {
  await vi.advanceTimersByTimeAsync(0);
  return FakeWorker.instances[0];
};

const job = { filePath: '/tmp/a.txt', kind: 'file', mode: 'file' } as FileParseJob;

describe('createFileParseRunner exit ordering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    FakeWorker.probes = [];
    FakeWorker.autoProbe = true;
  });
  afterEach(() => vi.useRealTimers());

  it('rejects with TIMEOUT when a result message arrives after the deadline, before the exit', async () => {
    const { createFileParseRunner } = await import('./runner');
    const runner = createFileParseRunner({
      parseTimeoutMs: 100,
      workerPath: () => '/x/worker.mjs',
    });

    const outcome = runner.run(job).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const worker = await nextWorker();

    await vi.advanceTimersByTimeAsync(150);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    // Late message from the dying thread, then the exit.
    worker.emit('message', { type: 'result', value: { content: 'late' } });
    expect(runner.stats().active).toBe(1);
    worker.emit('exit', 1);

    expect(await outcome).toMatchObject({ error: { code: 'TIMEOUT' } });
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('settles nothing before the exit even when the result message is already in', async () => {
    const { createFileParseRunner } = await import('./runner');
    const runner = createFileParseRunner({ workerPath: () => '/x/worker.mjs' });
    let settled = false;
    const outcome = runner.run(job).finally(() => (settled = true));
    const worker = await nextWorker();

    worker.emit('message', { type: 'result', value: 'ok' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    worker.emit('exit', 0);
    await expect(outcome).resolves.toBe('ok');
  });

  it('keeps the slot of a failed heap probe until the probe thread has really exited', async () => {
    FakeWorker.autoProbe = false;
    const { createFileParseRunner } = await import('./runner');
    const runner = createFileParseRunner({ workerPath: () => '/x/worker.mjs' });
    const outcome = runner.run(job).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const [probe] = FakeWorker.probes;

    probe.emit('error', new Error('probe crashed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.stats().active).toBe(1);

    probe.emit('exit', 1);
    expect(await outcome).toMatchObject({ error: { code: 'START_FAILED' } });
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
    // No parse worker was ever created.
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates a heap probe that never answers and rejects only after it has exited', async () => {
    FakeWorker.autoProbe = false;
    const { createFileParseRunner } = await import('./runner');
    // A short parse budget must not become the cold-start deadline of the probe thread.
    const runner = createFileParseRunner({
      parseTimeoutMs: 100,
      workerPath: () => '/x/worker.mjs',
    });
    const outcome = runner.run(job).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const [probe] = FakeWorker.probes;

    await vi.advanceTimersByTimeAsync(1000);
    expect(probe.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe.terminate).toHaveBeenCalledTimes(1);
    expect(runner.stats().active).toBe(1);

    probe.emit('exit', 1);
    expect(await outcome).toMatchObject({ error: { code: 'START_FAILED' } });
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
