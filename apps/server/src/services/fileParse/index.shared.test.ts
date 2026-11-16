import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FILE_PARSE_WORKER_PATH_ENV } from './artifact';
import { DEFAULT_FILE_PARSE_LIMITS } from './runner';

// The process-wide runner and the structured log line, with real threads running a scenario
// script: `content` of the dataset job selects the behaviour ("busy:<ms>" or "fail").
const SCENARIOS = `
import { parentPort, workerData as job } from 'node:worker_threads';
const [kind, arg] = String(job.content).split(':');
if (kind === 'busy') { const end = Date.now() + Number(arg); while (Date.now() < end); }
parentPort.postMessage(kind === 'fail'
  ? { type: 'error', error: { name: 'Error', message: 'corrupt' } }
  : { type: 'result', value: 'done' });
`;

let dir: string;
const previousEnv = process.env[FILE_PARSE_WORKER_PATH_ENV];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-shared-'));
  const workerPath = path.join(dir, 'scenarios.mjs');
  await writeFile(workerPath, SCENARIOS);
  process.env[FILE_PARSE_WORKER_PATH_ENV] = workerPath;
});

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[FILE_PARSE_WORKER_PATH_ENV];
  else process.env[FILE_PARSE_WORKER_PATH_ENV] = previousEnv;
  await rm(dir, { force: true, recursive: true });
});

afterEach(() => vi.restoreAllMocks());

const loadCopy = async () => {
  vi.resetModules();
  return import('./index');
};

describe('shared file parse runner', () => {
  it('is one runner for every module copy, so slot and queue limits hold per process', async () => {
    // Two copies, like two Next route bundles or a dev HMR reload.
    const copyA = await loadCopy();
    const copyB = await loadCopy();
    expect(copyA).not.toBe(copyB);
    expect(copyA.getSharedFileParseRunner()).toBe(copyB.getSharedFileParseRunner());

    const first = copyA.parseDatasetInWorker('busy:300');
    // The default limit is one running parse: a parse submitted through the other copy waits.
    const second = copyB.parseDatasetInWorker('busy:1');
    await vi.waitFor(() =>
      expect(copyB.getSharedFileParseRunner().stats()).toEqual({ active: 1, queued: 1 }),
    );
    expect(copyA.getSharedFileParseRunner().stats()).toEqual({ active: 1, queued: 1 });

    await Promise.all([first, second]);
    expect(copyA.getSharedFileParseRunner().stats()).toEqual({ active: 0, queued: 0 });
  });

  it('logs a refused task as waiting time only, not as a long parse', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { parseDatasetInWorker } = await loadCopy();

    // One running plus a full queue fill the runner; the next task is refused at once.
    const accepted = Array.from({ length: 1 + DEFAULT_FILE_PARSE_LIMITS.maxQueue }, () =>
      parseDatasetInWorker('busy:30'),
    );
    const refused = await parseDatasetInWorker('busy:1').catch((error) => error);
    await Promise.all(accepted);

    expect(refused).toMatchObject({ code: 'QUEUE_FULL' });
    const line = JSON.parse(warn.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ code: 'QUEUE_FULL', event: 'file_parse.failed', parseMs: 0 });
  });

  it('separates the queue wait from the parse time of a task that started late and failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { parseDatasetInWorker } = await loadCopy();

    const running = parseDatasetInWorker('busy:400');
    const failing = await parseDatasetInWorker('fail').catch((error) => error);
    await running;

    expect(failing).toMatchObject({ code: 'PARSE_FAILED' });
    const line = JSON.parse(warn.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ code: 'PARSE_FAILED', event: 'file_parse.failed' });
    expect(line.queuedMs).toBeGreaterThanOrEqual(0);
    expect(line.parseMs).toBeGreaterThanOrEqual(0);
  });

  it('refuses an input over the parse cap before it reaches a thread', async () => {
    const { parseDatasetInWorker, getSharedFileParseRunner } = await loadCopy();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tooBig = new Uint8Array(64 * 1024 * 1024 + 1);

    const error = await parseDatasetInWorker(tooBig, { format: 'xlsx' }).catch((e) => e);

    expect(error).toMatchObject({ code: 'INPUT_TOO_LARGE' });
    expect(getSharedFileParseRunner().stats()).toEqual({ active: 0, queued: 0 });
  });
});
