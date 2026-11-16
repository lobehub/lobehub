import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILE_PARSE_WORKER_PATH_ENV } from './artifact';
import { DEFAULT_FILE_PARSE_LIMITS } from './runner';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../file');
vi.mock('../document/history');
vi.mock('../resourceEvents', () => ({ publishResourceEvent: vi.fn() }));

// A real thread whose behaviour follows the file name of the job.
const SCENARIOS = `
import path from 'node:path';
import { parentPort, workerData as job } from 'node:worker_threads';
const name = path.basename(job.filePath ?? '');
if (name === 'busy.bin') { const end = Date.now() + 300; while (Date.now() < end); }
parentPort.postMessage(name === 'unsupported.zip'
  ? { type: 'error', error: { name: 'UnsupportedFileTypeError', message: 'unsupported', fileType: 'zip' } }
  : { type: 'result', value: { content: 'ok', metadata: {}, totalCharCount: 2, totalLineCount: 1 } });
`;

const SHARED_RUNNER_KEY = Symbol.for('lobehub.fileParse.sharedRunner');

let dir: string;
let workerPath: string;
const previousEnv = process.env[FILE_PARSE_WORKER_PATH_ENV];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-copies-'));
  workerPath = path.join(dir, 'scenarios.mjs');
  await writeFile(workerPath, SCENARIOS);
});

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[FILE_PARSE_WORKER_PATH_ENV];
  else process.env[FILE_PARSE_WORKER_PATH_ENV] = previousEnv;
  await rm(dir, { force: true, recursive: true });
});

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[SHARED_RUNNER_KEY];
  process.env[FILE_PARSE_WORKER_PATH_ENV] = workerPath;
});

/**
 * Copy A creates the process-wide runner (and so throws copy A's error classes); copy B is the
 * DocumentService a different bundle or an HMR reload keeps using, with its own classes.
 */
const loadCopies = async () => {
  vi.resetModules();
  const copyA = await import('./index');
  const errorsA = await import('./errors');
  const loadersA = await import('@lobechat/file-loaders');
  copyA.getSharedFileParseRunner();

  vi.resetModules();
  const { DocumentService } = await import('../document');
  const errorsB = await import('./errors');
  const loadersB = await import('@lobechat/file-loaders');
  const { DocumentModel } = await import('@/database/models/document');
  const { FileModel } = await import('@/database/models/file');
  const { KnowledgeBaseModel } = await import('@/database/models/knowledgeBase');
  const { FileService } = await import('../file');

  // The premise of every case below: two copies of the classes that `instanceof` would compare.
  expect(errorsA.FileParseError).not.toBe(errorsB.FileParseError);
  expect(loadersA.UnsupportedFileTypeError).not.toBe(loadersB.UnsupportedFileTypeError);

  const downloadFileToLocal = vi.fn();
  vi.mocked(DocumentModel).mockImplementation(function () {
    return { create: vi.fn(), findByFileId: vi.fn().mockResolvedValue(null) } as never;
  });
  vi.mocked(FileModel).mockImplementation(function () {
    return {} as never;
  });
  vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
    return {} as never;
  });
  vi.mocked(FileService).mockImplementation(function () {
    return { downloadFileToLocal } as never;
  });
  const db = {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute: vi.fn() }),
    ),
  } as never;

  const parseAs = (fileName: string) => {
    downloadFileToLocal.mockResolvedValue({
      cleanup: async () => {},
      file: { name: fileName, parentId: null, url: `s3://bucket/${fileName}` },
      filePath: path.join(dir, fileName),
    });
    return [
      () => new DocumentService(db, 'user-1').parseFile('file-1'),
      () => new DocumentService(db, 'user-1').parseDocument('file-1'),
    ];
  };

  return { copyA, parseAs };
};

// Each case reloads the document service twice; under a loaded full run that outlasts 5s.
describe('parse errors thrown by another module copy', { timeout: 30_000 }, () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it('maps a full queue to TOO_MANY_REQUESTS', async () => {
    const { copyA, parseAs } = await loadCopies();
    const runner = copyA.getSharedFileParseRunner();
    const job = { filePath: path.join(dir, 'busy.bin'), kind: 'file', mode: 'file' } as const;
    // One running parse and a full waiting list.
    const { maxQueue } = DEFAULT_FILE_PARSE_LIMITS;
    const fillers = Array.from({ length: 1 + maxQueue }, () => runner.run(job));
    expect(runner.stats()).toEqual({ active: 1, queued: maxQueue });

    for (const parse of parseAs('report.bin')) {
      const error = await parse().catch((e) => e);
      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    }
    await Promise.all(fillers);
  });

  it('maps a missing worker artifact to SERVICE_UNAVAILABLE', async () => {
    const { parseAs } = await loadCopies();
    process.env[FILE_PARSE_WORKER_PATH_ENV] = path.join(dir, 'missing.mjs');

    for (const parse of parseAs('report.bin')) {
      const error = await parse().catch((e) => e);
      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }
  });

  it('keeps an unsupported file type a BAD_REQUEST', async () => {
    const { parseAs } = await loadCopies();

    for (const parse of parseAs('unsupported.zip')) {
      const error = await parse().catch((e) => e);
      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(error.cause).toMatchObject({ name: 'UnsupportedFileTypeError' });
    }
  });
});
