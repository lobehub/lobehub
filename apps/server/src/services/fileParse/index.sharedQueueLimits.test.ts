import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MAX_UPLOAD_FILE_COUNT } from '@lobechat/const';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FILE_PARSE_WORKER_PATH_ENV } from './artifact';
import { createFileParseRunner } from './runner';

// `content` of the dataset job is "busy:<ms>"; real threads run it.
const SCENARIOS = `
import { parentPort, workerData as job } from 'node:worker_threads';
const end = Date.now() + Number(String(job.content).split(':')[1] ?? 0);
while (Date.now() < end);
parentPort.postMessage({ type: 'result', value: 'done' });
`;

const SHARED_RUNNER_KEY = Symbol.for('lobehub.fileParse.sharedRunner');

let dir: string;
let workerPath: string;
const previousEnv = process.env[FILE_PARSE_WORKER_PATH_ENV];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-shared-limits-'));
  workerPath = path.join(dir, 'scenarios.mjs');
  await writeFile(workerPath, SCENARIOS);
  process.env[FILE_PARSE_WORKER_PATH_ENV] = workerPath;
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[SHARED_RUNNER_KEY];
});

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[FILE_PARSE_WORKER_PATH_ENV];
  else process.env[FILE_PARSE_WORKER_PATH_ENV] = previousEnv;
  await rm(dir, { force: true, recursive: true });
});

const loadCopy = async () => {
  vi.resetModules();
  return import('./index');
};

describe('queue limits across module copies', () => {
  it('share the waiting-task count: copies together hold one upload, the next is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const copyA = await loadCopy();
    const copyB = await loadCopy();

    const parses = [copyA.parseDatasetInWorker('busy:200')];
    // The rest of the upload arrives alternately through the two copies.
    for (let i = 1; i < MAX_UPLOAD_FILE_COUNT; i += 1) {
      parses.push((i % 2 ? copyA : copyB).parseDatasetInWorker('busy:0'));
    }
    expect(copyA.getSharedFileParseRunner().stats()).toEqual({
      active: 1,
      queued: MAX_UPLOAD_FILE_COUNT - 1,
    });

    for (const copy of [copyA, copyB]) {
      expect(await copy.parseDatasetInWorker('busy:0').catch((e) => e)).toMatchObject({
        code: 'QUEUE_FULL',
      });
    }
    await expect(Promise.all(parses)).resolves.toHaveLength(MAX_UPLOAD_FILE_COUNT);
  });

  it('share the queued byte budget: bytes waiting in one copy count against the other', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The route copies find the runner on globalThis; this one has a small byte budget.
    (globalThis as Record<symbol, unknown>)[SHARED_RUNNER_KEY] = createFileParseRunner({
      maxQueuedBytes: 20,
      workerPath: () => workerPath,
    });
    const copyA = await loadCopy();
    const copyB = await loadCopy();

    const running = copyA.parseDatasetInWorker('busy:200'); // 8 bytes, runs at once
    const fromA = copyA.parseDatasetInWorker('busy:0'); // 6 bytes queued
    const fromB = copyB.parseDatasetInWorker('busy:0'); // 6 bytes queued, 12 of 20
    const tooMuch = await copyB.parseDatasetInWorker('busy:0:padding!!').catch((e) => e); // 16 bytes
    expect(tooMuch).toMatchObject({ code: 'QUEUE_FULL' });

    await Promise.all([running, fromA, fromB]);
    // Everything left the queue, so the budget is whole again: a 16-byte task fits behind a runner.
    const next = copyA.parseDatasetInWorker('busy:150');
    const fits = copyB.parseDatasetInWorker('busy:0:padding!!');
    expect(copyA.getSharedFileParseRunner().stats()).toEqual({ active: 1, queued: 1 });
    await Promise.all([next, fits]);
  });
});
