import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MAX_UPLOAD_FILE_COUNT } from '@lobechat/const';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FileParseJob } from './protocol';
import { createFileParseRunner, DEFAULT_FILE_PARSE_LIMITS } from './runner';

// Real worker threads: the budget must be released when a task leaves the queue, whichever way.
// `ms` is how long the thread keeps the slot busy.
const SCENARIOS = `
import { parentPort, workerData as job } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
// A native sleep keeps the thread where terminate() cannot interrupt it.
if (job.sleep) spawnSync('sleep', [String(job.sleep)]);
const end = Date.now() + (job.ms ?? 0);
while (Date.now() < end);
parentPort.postMessage({ type: 'result', value: 'done' });
`;

let dir: string;
let workerPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-queue-limits-'));
  workerPath = path.join(dir, 'scenarios.mjs');
  await writeFile(workerPath, SCENARIOS);
});

afterAll(() => rm(dir, { force: true, recursive: true }));
afterEach(() => vi.restoreAllMocks());

/** A file job waits as a path: it holds no bytes. */
const fileJob = (ms = 0) =>
  ({ filePath: '/unused/report.pdf', kind: 'file', mode: 'file', ms }) as unknown as FileParseJob;
/** A dataset job waits with its content in memory. */
const datasetJob = (bytes: number, ms = 0) =>
  ({ content: new Uint8Array(bytes), kind: 'dataset', ms }) as unknown as FileParseJob;

/** A chunk job also waits with the whole file in memory. */
const chunkJob = (bytes: number, ms = 0) =>
  ({
    content: new Uint8Array(bytes),
    filename: 'a.xlsx',
    kind: 'chunk',
    ms,
  }) as unknown as FileParseJob;

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => error,
  );

describe('default queue limits', () => {
  it('keeps one slot and a queue that holds the rest of one upload', () => {
    expect(DEFAULT_FILE_PARSE_LIMITS.maxConcurrent).toBe(1);
    expect(DEFAULT_FILE_PARSE_LIMITS.maxOldGenerationSizeMb).toBe(768);
    expect(DEFAULT_FILE_PARSE_LIMITS.maxQueue).toBeGreaterThanOrEqual(MAX_UPLOAD_FILE_COUNT - 1);
  });

  it('parses a whole upload of ordinary attachments at once, and refuses the one after', async () => {
    const runner = createFileParseRunner({ workerPath: () => workerPath });

    // resolveAttachments starts every attachment together (Promise.all).
    const upload = Array.from({ length: MAX_UPLOAD_FILE_COUNT }, (_, i) =>
      runner.run(fileJob(i === 0 ? 150 : 0)),
    );
    expect(runner.stats()).toEqual({ active: 1, queued: MAX_UPLOAD_FILE_COUNT - 1 });

    const eleventh = await rejection(runner.run(fileJob()));
    expect(eleventh).toMatchObject({ code: 'QUEUE_FULL' });
    expect(runner.stats()).toEqual({ active: 1, queued: MAX_UPLOAD_FILE_COUNT - 1 });

    await expect(Promise.all(upload)).resolves.toEqual(
      Array.from({ length: MAX_UPLOAD_FILE_COUNT }, () => 'done'),
    );
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });
});

describe('queue wait budget', () => {
  it('is the bounded serial time of one normal upload: parse timeout x upload file count', () => {
    expect(DEFAULT_FILE_PARSE_LIMITS.maxConcurrent).toBe(1);
    expect(DEFAULT_FILE_PARSE_LIMITS.parseTimeoutMs).toBe(60_000);
    expect(DEFAULT_FILE_PARSE_LIMITS.queueTimeoutMs).toBe(
      DEFAULT_FILE_PARSE_LIMITS.parseTimeoutMs * MAX_UPLOAD_FILE_COUNT,
    );
    // the last queued task waits behind at most maxQueue tasks that each run a full timeout
    expect(DEFAULT_FILE_PARSE_LIMITS.queueTimeoutMs).toBeGreaterThan(
      DEFAULT_FILE_PARSE_LIMITS.parseTimeoutMs * DEFAULT_FILE_PARSE_LIMITS.maxQueue,
    );
  });

  it('lets a whole upload of slow files finish one after another', async () => {
    // Observe the scheduled budgets without advancing a fake clock alongside real workers.
    // Ten serial parse budgets must fit; the old fixed 30s queue budget would expire too early.
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const runner = createFileParseRunner({ parseTimeoutMs: 5000, workerPath: () => workerPath });
    const starts: number[] = [];
    const upload = Array.from({ length: MAX_UPLOAD_FILE_COUNT }, (_, i) =>
      runner.run(fileJob(), { onStart: () => starts.push(i) }),
    );
    expect(runner.stats()).toEqual({ active: 1, queued: MAX_UPLOAD_FILE_COUNT - 1 });

    await expect(Promise.all(upload)).resolves.toEqual(
      Array.from({ length: MAX_UPLOAD_FILE_COUNT }, () => 'done'),
    );
    expect(starts).toEqual(Array.from({ length: MAX_UPLOAD_FILE_COUNT }, (_, i) => i));
    const budgets = timers.mock.calls.map(([, delay]) => delay);
    expect(budgets.filter((delay) => delay === 5000)).toHaveLength(MAX_UPLOAD_FILE_COUNT);
    expect(budgets.filter((delay) => delay === 5000 * MAX_UPLOAD_FILE_COUNT)).toHaveLength(
      MAX_UPLOAD_FILE_COUNT - 1,
    );
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  }, 20_000);

  it('still bounds the wait: a queued task behind a thread that will not die gives up at the derived budget', async () => {
    // parse timeout 200ms, queue of 2 => 600ms. The thread sits in native code for 2s.
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const runner = createFileParseRunner({
      maxQueue: 2,
      parseTimeoutMs: 200,
      workerPath: () => workerPath,
    });
    const stuck = rejection(runner.run({ ...fileJob(), sleep: 2 } as unknown as FileParseJob));
    const queued = await rejection(runner.run(fileJob()));

    expect(queued).toMatchObject({ code: 'QUEUE_TIMEOUT' });
    expect(timers.mock.calls.map(([, delay]) => delay)).toContain(600);
    expect(runner.stats()).toEqual({ active: 1, queued: 0 });
    expect(await stuck).toMatchObject({ code: 'TIMEOUT' });
  }, 20_000);

  it('an explicit queueTimeoutMs still wins', async () => {
    const runner = createFileParseRunner({
      parseTimeoutMs: 5000,
      queueTimeoutMs: 100,
      workerPath: () => workerPath,
    });
    const running = runner.run(fileJob(400));
    expect(await rejection(runner.run(fileJob()))).toMatchObject({ code: 'QUEUE_TIMEOUT' });
    await running;
  });
});

describe('queued input byte budget', () => {
  const makeRunner = (
    extra: Parameters<typeof createFileParseRunner>[0] extends infer T ? Partial<T> : never = {},
  ) => createFileParseRunner({ maxQueuedBytes: 100, workerPath: () => workerPath, ...extra });

  it('has a default that keeps queued content well inside the process memory', () => {
    expect(DEFAULT_FILE_PARSE_LIMITS.maxQueuedBytes).toBe(128 * 1024 * 1024);
  });

  it('refuses at once a task whose content would push the waiting bytes over the budget', async () => {
    const runner = makeRunner();
    const running = runner.run(fileJob(200));
    const waiting = [runner.run(datasetJob(60)), runner.run(datasetJob(40))];
    expect(runner.stats()).toEqual({ active: 1, queued: 2 });

    // 100 of 100 bytes are queued: even one more byte is refused, count is far from the limit.
    const error = await rejection(runner.run(datasetJob(1)));
    expect(error).toMatchObject({ code: 'QUEUE_FULL' });
    expect(runner.stats()).toEqual({ active: 1, queued: 2 });

    await Promise.all([running, ...waiting]);
  });

  it('counts string content by its UTF-8 bytes', async () => {
    const runner = makeRunner();
    const running = runner.run(fileJob(150));
    // 40 CJK characters are 120 bytes, over the 100-byte budget although only 40 characters long.
    const text = { content: '数'.repeat(40), kind: 'dataset', ms: 0 } as unknown as FileParseJob;
    const error = await rejection(runner.run(text));
    expect(error).toMatchObject({ code: 'QUEUE_FULL' });
    await running;
  });

  it('does not count a file job, which waits as a path', async () => {
    const runner = makeRunner();
    const running = runner.run(fileJob(150));
    const waiting = [runner.run(datasetJob(100)), runner.run(fileJob()), runner.run(fileJob())];
    expect(runner.stats()).toEqual({ active: 1, queued: 3 });
    await Promise.all([running, ...waiting]);
  });

  it('gives the budget back when a queued task starts', async () => {
    const runner = makeRunner();
    const running = runner.run(fileJob(100));
    const queued = runner.run(datasetJob(100, 200));
    expect(await rejection(runner.run(datasetJob(10)))).toMatchObject({ code: 'QUEUE_FULL' });

    await running; // the queued dataset job now holds the slot, no longer the queue
    expect(runner.stats()).toMatchObject({ active: 1, queued: 0 });
    const next = runner.run(datasetJob(100));
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });

    await Promise.all([queued, next]);
  });

  it('gives the budget back when a queued task times out', async () => {
    const runner = makeRunner({ queueTimeoutMs: 100 });
    const running = runner.run(fileJob(400));
    const timedOut = await rejection(runner.run(datasetJob(100)));
    expect(timedOut).toMatchObject({ code: 'QUEUE_TIMEOUT' });
    expect(runner.stats()).toEqual({ active: 1, queued: 0 });

    // The whole budget is free again: a 100-byte task is accepted (and later times out as well).
    const next = rejection(runner.run(datasetJob(100)));
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });
    expect(await next).toMatchObject({ code: 'QUEUE_TIMEOUT' });
    await running;
  });

  it('does not charge a refused task', async () => {
    const runner = makeRunner();
    const running = runner.run(fileJob(150));
    expect(await rejection(runner.run(datasetJob(101)))).toMatchObject({ code: 'QUEUE_FULL' });
    const fits = runner.run(datasetJob(100));
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });
    await Promise.all([running, fits]);
  });
});

describe('chunk jobs share the queue byte budget', () => {
  it('counts the content of waiting chunk jobs and refuses what would not fit', async () => {
    const runner = createFileParseRunner({
      maxQueuedBytes: 1000,
      queueTimeoutMs: 5000,
      workerPath: () => workerPath,
    });
    const running = runner.run(fileJob(150));
    const waiting = runner.run(chunkJob(600));

    const refused = await rejection(runner.run(chunkJob(401)));
    expect(refused).toMatchObject({ code: 'QUEUE_FULL' });
    // a rejected job holds nothing, and a dataset job competes for the very same budget
    const fits = runner.run(datasetJob(400));
    expect(runner.stats().queued).toBe(2);
    expect(await rejection(runner.run(datasetJob(1)))).toMatchObject({ code: 'QUEUE_FULL' });

    await Promise.all([running, waiting, fits]);
  });
});
