import { AsyncLocalStorage } from 'node:async_hooks';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileParseJob } from './protocol';
import { createFileParseRunner } from './runner';

// The runner prepares its scratch directory and checks the artifact with async fs only, and says
// so (a structured event, no path) when the scratch directory cannot be removed. The hooks let a
// test hold or fail one fs call while the worker thread stays real.
const hooks = vi.hoisted(() => ({
  access: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
  mkdtemp: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
  rm: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    access: (...args: unknown[]) =>
      hooks.access ? hooks.access(...args) : (actual.access as any)(...args),
    mkdtemp: (...args: unknown[]) =>
      hooks.mkdtemp ? hooks.mkdtemp(...args) : (actual.mkdtemp as any)(...args),
    rm: (...args: unknown[]) => (hooks.rm ? hooks.rm(...args) : (actual.rm as any)(...args)),
  };
});

// The request thread must not touch the filesystem synchronously for a task.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  existsSync: () => {
    throw new Error('existsSync on the request thread');
  },
  mkdtempSync: () => {
    throw new Error('mkdtempSync on the request thread');
  },
}));

// The module is mocked below; the test itself talks to the real one.
const {
  mkdtemp: realMkdtemp,
  readdir,
  rm: realRm,
  writeFile,
} = await vi.importActual<typeof FsPromises>('node:fs/promises');

const SCENARIOS = `
import { parentPort, workerData as job } from 'node:worker_threads';
const end = Date.now() + (job.ms ?? 0);
while (Date.now() < end);
if (job.scenario === 'error') parentPort.postMessage({ type: 'error', error: { name: 'Error', message: 'corrupt zip' } });
else parentPort.postMessage({ type: 'result', value: process.env.TMPDIR });
`;

let dir: string;
let workerPath: string;

beforeAll(async () => {
  dir = await realMkdtemp(path.join(tmpdir(), 'file-parse-scratch-'));
  workerPath = path.join(dir, 'scenarios.mjs');
  await writeFile(workerPath, SCENARIOS);
});
afterAll(() => realRm(dir, { force: true, recursive: true }));

let scratchRoot: string;
let previousTmp: string | undefined;
beforeEach(async () => {
  scratchRoot = await realMkdtemp(path.join(tmpdir(), 'file-parse-scratch-root-'));
  previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = scratchRoot;
});
afterEach(async () => {
  hooks.access = hooks.mkdtemp = hooks.rm = undefined;
  vi.restoreAllMocks();
  if (previousTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmp;
  await realRm(scratchRoot, { force: true, recursive: true });
});

const chunkJob = (extra: Record<string, unknown> = {}) =>
  ({
    content: new Uint8Array(4),
    filename: 'secret-name.epub',
    kind: 'chunk',
    ...extra,
  }) as unknown as FileParseJob;
const fileJob = () =>
  ({ filePath: '/unused/report.pdf', kind: 'file', mode: 'file' }) as unknown as FileParseJob;
const make = (
  limits: Parameters<typeof createFileParseRunner>[0] extends infer T ? Partial<T> : never = {},
) => createFileParseRunner({ workerPath: () => workerPath, ...limits });
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e) => e,
  );
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, reject, resolve };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('async preparation on the request thread', () => {
  it('runs file and chunk jobs without sync fs (existsSync / mkdtempSync would throw)', async () => {
    const runner = make();
    await expect(runner.run(fileJob())).resolves.toBeDefined();
    const scratch = await runner.run<string>(chunkJob());
    expect(path.dirname(scratch)).toBe(scratchRoot);
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it('takes the slot at once, so a task arriving while the scratch directory is being made queues', async () => {
    const made = deferred<string>();
    hooks.mkdtemp = () => made.promise;
    const runner = make();
    const started: string[] = [];

    const first = runner.run<string>(chunkJob(), { onStart: () => started.push('first') });
    expect(runner.stats()).toEqual({ active: 1, queued: 0 });
    const second = runner.run<string>(fileJob(), { onStart: () => started.push('second') });
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });
    await sleep(50);
    expect(started).toEqual([]); // nothing runs before the directory exists

    made.resolve(await realMkdtemp(path.join(scratchRoot, 'file-parse-')));
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('gives the slot back and runs the next task when the scratch directory cannot be made', async () => {
    hooks.mkdtemp = () => Promise.reject(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    const runner = make();
    const failing = rejection(runner.run(chunkJob()));
    const next = runner.run(fileJob());
    expect(await failing).toMatchObject({ code: 'START_FAILED' });
    await expect(next).resolves.toBeDefined();
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('fails closed with UNAVAILABLE when the artifact is missing, and moves on', async () => {
    let missing = true;
    const runner = createFileParseRunner({
      workerPath: () => (missing ? path.join(dir, 'nope.mjs') : workerPath),
    });
    const first = rejection(runner.run(fileJob()));
    const second = runner.run(fileJob());
    expect(await first).toMatchObject({ code: 'UNAVAILABLE' });
    // `second` was queued behind the first; it saw the same missing file.
    expect(await rejection(second)).toMatchObject({ code: 'UNAVAILABLE' });
    missing = false;
    await expect(runner.run(fileJob())).resolves.toBeDefined();
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('keeps each task activity: a bound onStart sees the context of its own caller', async () => {
    const { AsyncResource } = await import('node:async_hooks');
    const als = new AsyncLocalStorage<string>();
    const seen: Array<[string, string | undefined]> = [];
    const runner = make();
    const run = (name: string) =>
      als.run(name, () =>
        runner.run(chunkJob(), {
          onStart: AsyncResource.bind(() => seen.push([name, als.getStore()])),
        }),
      );
    await Promise.all([run('a'), run('b'), run('c')]);
    expect(seen).toEqual([
      ['a', 'a'],
      ['b', 'b'],
      ['c', 'c'],
    ]);
  });
});

describe('scratch directory cleanup', () => {
  it('settles only after the removal, and frees the slot only then', async () => {
    const removal = deferred();
    hooks.rm = (...args) => removal.promise.then(() => (realRm as any)(...args));
    const runner = make();
    let settled = false;
    const run = runner.run<string>(chunkJob()).finally(() => (settled = true));
    await sleep(300); // the thread has long exited
    expect(settled).toBe(false);
    expect(runner.stats().active).toBe(1);
    // a new task cannot jump the queue in the gap
    const waiting = runner.run(fileJob());
    expect(runner.stats()).toEqual({ active: 1, queued: 1 });

    removal.resolve();
    await Promise.all([run, waiting]);
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('reports a failed removal as its own event and keeps the parse result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hooks.rm = () =>
      Promise.reject(Object.assign(new Error(`EIO at ${scratchRoot}/x`), { code: 'EIO' }));
    const runner = make();

    const value = await runner.run<string>(chunkJob());
    expect(path.dirname(value)).toBe(scratchRoot); // the original result, untouched
    expect(runner.stats()).toEqual({ active: 0, queued: 0 });

    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      code: 'EIO',
      event: 'file_parse.cleanup_failed',
      jobKind: 'chunk',
    });
    expect(lines[0]).not.toContain(scratchRoot);
    expect(lines[0]).not.toContain('secret-name');
  });

  it('keeps the original error when the parse failed and the removal failed too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hooks.rm = () => Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    const runner = make();

    const error = await rejection(runner.run(chunkJob({ scenario: 'error' })));
    expect(error).toMatchObject({ code: 'PARSE_FAILED', message: 'corrupt zip' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ code: 'EPERM' });
  });
});
