import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileParseJob } from './protocol';

// The event order "deadline passed, terminate() called, a message still arrives, then exit" cannot
// be produced deterministically with a real thread (terminate() usually drops the pending
// message). The real-thread behaviour is covered in runner.test.ts; this pins the ordering rule.
class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = [];
  terminate = vi.fn(async () => 0);
  constructor() {
    super();
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
});
