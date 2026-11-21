import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UnsupportedFileTypeError } from '@lobechat/file-loaders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileParseError } from './errors';
import type { FileParseJob } from './protocol';
import { createFileParseRunner } from './runner';

// Real worker threads running a scenario script: the runner's contract is about thread exit, which
// no mock can stand in for. A scenario spins on the CPU like a heavy parser does.
const SCENARIOS = `
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parentPort, workerData as job } from 'node:worker_threads';

const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end); };
// Keeps writing while alive, so a test can tell when the thread is really gone.
const beat = (file) => { for (;;) { appendFileSync(file, 'x'); busy(10); } };
const post = (message) => parentPort.postMessage(message);

switch (job.scenario) {
  case 'busy': busy(job.ms); post({ type: 'result', value: job.value ?? 'done' }); break;
  case 'forever': beat(job.beatFile); break;
  case 'result-then-spin': post({ type: 'result', value: 'ok' }); beat(job.beatFile); break;
  case 'throw': throw new Error('boom at top level');
  case 'exit': process.exit(3);
  case 'unsupported': post({ type: 'error', error: { name: 'UnsupportedFileTypeError', fileType: 'xyz', message: 'x' } }); break;
  case 'load-failed': post({ type: 'error', error: { name: 'FileLoadFailedError', message: 'all pages failed' } }); break;
  case 'plain-error': post({ type: 'error', error: { name: 'Error', message: 'corrupt zip' } }); break;
  case 'native-block': spawnSync('sleep', [String(job.seconds)]); beat(job.beatFile); break;
  case 'oom': { const hold = []; for (;;) hold.push(new Array(100000).fill('x'.repeat(16))); }
  case 'env': post({ type: 'result', value: Object.keys(process.env) }); break;
}
`;

let dir: string;
let workerPath: string;
let beatCounter = 0;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-runner-'));
  workerPath = path.join(dir, 'scenarios.mjs');
  await writeFile(workerPath, SCENARIOS);
});

afterAll(() => rm(dir, { force: true, recursive: true }));

const job = (data: Record<string, unknown>) => data as unknown as FileParseJob;
const newBeatFile = () => path.join(dir, `beat-${beatCounter++}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sizeOf = async (file: string) => (await stat(file).catch(() => ({ size: 0 }))).size;

const makeRunner = (
  limits: Parameters<typeof createFileParseRunner>[0] extends infer T ? Partial<T> : never = {},
) => createFileParseRunner({ workerPath: () => workerPath, ...limits });

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the task to reject');
};

describe('createFileParseRunner', () => {
  it('keeps the main thread timers running while a worker holds the CPU', async () => {
    const runner = makeRunner();
    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
    }, 20);

    let value;
    try {
      value = await runner.run(job({ ms: 700, scenario: 'busy' }));
    } finally {
      clearInterval(interval);
    }

    expect(value).toBe('done');
    expect(ticks).toBeGreaterThan(0);
  });

  it('terminates a worker that outlives its budget and settles only after it exited', async () => {
    const runner = makeRunner({ parseTimeoutMs: 200 });
    const beatFile = newBeatFile();

    const error = await rejection(runner.run(job({ beatFile, scenario: 'forever' })));

    expect(error).toMatchObject({ code: 'TIMEOUT', name: 'FileParseError' });
    // The slot is free and the thread no longer writes: the exit had happened before the rejection.
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
    const afterReject = await sizeOf(beatFile);
    await sleep(150);
    expect(await sizeOf(beatFile)).toBe(afterReject);
  });

  it('resolves a finished task only once its thread is gone', async () => {
    const runner = makeRunner();
    const beatFile = newBeatFile();

    await expect(runner.run(job({ beatFile, scenario: 'result-then-spin' }))).resolves.toBe('ok');

    expect(runner.stats().active).toBe(0);
    const afterResolve = await sizeOf(beatFile);
    await sleep(150);
    expect(await sizeOf(beatFile)).toBe(afterResolve);
  });

  it('refuses work beyond slots plus queue at once, and runs queued work in order', async () => {
    const runner = makeRunner({ maxConcurrent: 1, maxQueue: 1 });
    const order: string[] = [];
    const first = runner
      .run(job({ ms: 300, scenario: 'busy', value: 'first' }))
      .then((v) => order.push(String(v)));
    const second = runner
      .run(job({ ms: 10, scenario: 'busy', value: 'second' }))
      .then((v) => order.push(String(v)));
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });

    const error = await rejection(runner.run(job({ ms: 10, scenario: 'busy', value: 'third' })));
    expect(error).toMatchObject({ code: 'QUEUE_FULL' });
    expect(order).toEqual([]);

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('fails a task that waits too long for a slot without disturbing the running one', async () => {
    const runner = makeRunner({ queueTimeoutMs: 100 });
    const running = runner.run(job({ ms: 500, scenario: 'busy' }));
    const waiting = runner.run(job({ ms: 10, scenario: 'busy' }));

    const error = await rejection(waiting);

    expect(error).toMatchObject({ code: 'QUEUE_TIMEOUT' });
    expect((error as FileParseError).retryable).toBe(true);
    expect(runner.stats()).toEqual({ active: 1, queued: 0 });
    await expect(running).resolves.toBe('done');
  });

  it.each([
    ['throws outside the parse', 'throw', 'WORKER_FAILED'],
    ['exits without a message', 'exit', 'WORKER_FAILED'],
    ['reports a parse error', 'plain-error', 'PARSE_FAILED'],
    ['reports a failed load', 'load-failed', 'LOAD_FAILED'],
  ])(
    'rejects with a typed error when a worker %s, and the next task still runs',
    async (_, scenario, code) => {
      const runner = makeRunner();

      const error = await rejection(runner.run(job({ scenario })));
      expect(error).toBeInstanceOf(FileParseError);
      expect(error).toMatchObject({ code });

      expect(runner.stats().active).toBe(0);
      await expect(runner.run(job({ ms: 1, scenario: 'busy' }))).resolves.toBe('done');
    },
  );

  it('turns running out of the heap limit into a typed error and survives it', async () => {
    const runner = makeRunner({ maxOldGenerationSizeMb: 64 });

    const error = await rejection(runner.run(job({ scenario: 'oom' })));

    expect(error).toMatchObject({ code: 'OUT_OF_MEMORY' });
    await expect(runner.run(job({ ms: 1, scenario: 'busy' }))).resolves.toBe('done');
  });

  it('keeps UnsupportedFileTypeError semantics across the thread boundary', async () => {
    const runner = makeRunner();

    const error = await rejection(
      runner.run(
        job({
          filePath: '/tmp/some/archive.xyz',
          kind: 'file',
          mode: 'file',
          scenario: 'unsupported',
        }),
      ),
    );

    expect(error).toBeInstanceOf(UnsupportedFileTypeError);
    expect((error as UnsupportedFileTypeError).message).toBe(
      "Unsupported file type 'xyz' for file 'archive.xyz'.",
    );
  });

  it('never falls back to parsing in-process when the artifact is missing', async () => {
    const runner = createFileParseRunner({ workerPath: () => path.join(dir, 'missing.mjs') });

    const error = await rejection(runner.run(job({ scenario: 'busy' })));

    expect(error).toMatchObject({ code: 'UNAVAILABLE' });
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('gives the worker no process credentials', async () => {
    process.env.FILE_PARSE_TEST_SECRET = 'secret';
    try {
      const keys = await makeRunner().run<string[]>(job({ scenario: 'env' }));
      expect(keys).not.toContain('FILE_PARSE_TEST_SECRET');
      expect(keys).not.toContain('DATABASE_URL');
    } finally {
      delete process.env.FILE_PARSE_TEST_SECRET;
    }
  });

  it('keeps a task pending, its temp file and the queue untouched until a stuck thread has exited', async () => {
    // The queue wait is fixed: the default follows the parse timeout, which is 100ms here.
    const runner = makeRunner({ parseTimeoutMs: 100, queueTimeoutMs: 10_000 });
    const beatFile = newBeatFile();
    const tempFile = path.join(dir, `temp-${beatCounter++}`);
    await writeFile(tempFile, 'payload');

    // Like DocumentService: the temp file goes in `finally`, i.e. as soon as the task settles.
    let settled = false;
    // `sleep` blocks the thread in native code for 1.2s: terminate() cannot interrupt it.
    const stuck = runner
      .run(job({ beatFile, scenario: 'native-block', seconds: 1.2 }))
      .finally(() => {
        settled = true;
        return rm(tempFile, { force: true });
      });
    const stuckResult = rejection(stuck);
    let nextStarted = false;
    const next = runner.run(job({ ms: 1, scenario: 'busy', value: 'after' }), {
      onStart: () => (nextStarted = true),
    });

    // Well past the 100ms deadline (terminate() was called), long before the sleep returns.
    await sleep(600);
    expect(settled).toBe(false);
    expect(await sizeOf(tempFile)).toBeGreaterThan(0);
    expect(nextStarted).toBe(false);
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });

    const error = await stuckResult;
    expect(error).toMatchObject({ code: 'TIMEOUT' });
    expect(settled).toBe(true);
    expect(await sizeOf(tempFile)).toBe(0);
    await expect(next).resolves.toBe('after');
    expect(nextStarted).toBe(true);
    expect(runner.stats().active).toBe(0);
  });
});
