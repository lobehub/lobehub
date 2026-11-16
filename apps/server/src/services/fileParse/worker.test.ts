import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UnsupportedFileTypeError } from '@lobechat/file-loaders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { snapshotActivities } from '@/server/modules/RuntimeActivity';

import { buildFileParseWorker } from '../../../../../scripts/buildFileParseWorker.mjs';
import { PARSED_FILE_CONTENT_MAX_CHARS } from '../document/parsedFileCap';
import { FILE_PARSE_WORKER_PATH_ENV } from './artifact';
import { FileParseError, parseDatasetInWorker, parseFileInWorker } from './index';

// The real build artifact in real threads: this is what a pod runs. A 100k-row sparse range keeps
// a worker busy for ~1.5s, which on the request thread would stall every timer for as long.
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const SPARSE_ROWS = 100_000;
const CORRUPTED_PPTX = here(
  '../../../../../packages/file-loaders/src/loaders/pptx/fixtures/corrupted-slides.pptx',
);

let dir: string;
let SPARSE_XLSX: string;
const previousEnv = process.env[FILE_PARSE_WORKER_PATH_ENV];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-worker-'));
  process.env[FILE_PARSE_WORKER_PATH_ENV] = await buildFileParseWorker({
    outdir: path.join(dir, 'artifact'),
  });

  // Two cells, but a declared range of 100k x 50: `sheet_to_json` walks every empty cell of it.
  const XLSX = createRequire(here('../../../../../packages/file-loaders/package.json'))('xlsx');
  SPARSE_XLSX = path.join(dir, 'sparse-range.xlsx');
  await writeFile(
    SPARSE_XLSX,
    XLSX.write(
      {
        SheetNames: ['S'],
        Sheets: {
          S: {
            '!ref': `A1:AX${SPARSE_ROWS}`,
            'A1': { t: 's', v: 'head' },
            [`AX${SPARSE_ROWS}`]: { t: 's', v: 'tail' },
          },
        },
      },
      { bookType: 'xlsx', type: 'buffer' },
    ),
  );
}, 60_000);

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[FILE_PARSE_WORKER_PATH_ENV];
  else process.env[FILE_PARSE_WORKER_PATH_ENV] = previousEnv;
  await rm(dir, { force: true, recursive: true });
});

const write = async (name: string, content: string | Uint8Array) => {
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
};

const trackTimerProgress = () => {
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 20);
  return () => {
    clearInterval(interval);
    return ticks;
  };
};

describe('file parse worker artifact', () => {
  it('parses a spreadsheet with a huge declared range without stalling the main thread', async () => {
    const stop = trackTimerProgress();
    let ticks = 0;

    const document = await parseFileInWorker(SPARSE_XLSX, {
      fileId: 'file-sparse',
      mode: 'file',
    }).finally(() => {
      ticks = stop();
    });

    expect(document.content).toContain('tail');
    // A callback ran while the parse was pending on its worker thread.
    expect(ticks).toBeGreaterThan(0);
  });

  it('parses an eval dataset spreadsheet in the same bounded worker', async () => {
    const content = new Uint8Array(await readFile(SPARSE_XLSX));
    const stop = trackTimerProgress();
    let ticks = 0;

    const result = await parseDatasetInWorker<{ totalCount: number }>(content, {
      filename: 'sparse.xlsx',
      preview: 50,
    }).finally(() => {
      ticks = stop();
    });

    expect(ticks).toBeGreaterThan(0);
    expect(result.totalCount).toBeGreaterThan(0);
  });

  it('parses CSV datasets and reports a broken JSON dataset as a parse failure', async () => {
    await expect(
      parseDatasetInWorker<{ totalCount: number }>('a,b\n1,2\n3,4\n', { format: 'csv' }),
    ).resolves.toMatchObject({ totalCount: 2 });

    const error = await parseDatasetInWorker('{not json', { format: 'json' }).catch((e) => e);
    expect(error).toBeInstanceOf(FileParseError);
    expect(error).toMatchObject({ code: 'PARSE_FAILED' });
  });

  it('strips page wrappers for the page editor but keeps them for parseFile', async () => {
    const file = await write(
      'pages.txt',
      '<page number="1">alpha</page><page number="2">beta</page>',
    );

    const asDocument = await parseFileInWorker(file, { mode: 'document' });
    const asFile = await parseFileInWorker(file, { mode: 'file' });

    expect(asDocument.content).toBe('alphabeta');
    expect(asFile.content).toContain('<page number="1">');
  });

  it('caps oversized text inside the worker, so the main thread never receives the whole of it', async () => {
    const file = await write('huge.txt', 'a'.repeat(PARSED_FILE_CONTENT_MAX_CHARS + 100));

    const document = await parseFileInWorker(file, { mode: 'file' });

    expect(document.content).toHaveLength(PARSED_FILE_CONTENT_MAX_CHARS);
    expect(document.metadata).toMatchObject({
      originalCharCount: PARSED_FILE_CONTENT_MAX_CHARS + 100,
      truncated: true,
    });
  });

  it('keeps UnsupportedFileTypeError for files no loader handles', async () => {
    const file = await write('payload.qzx', 'binary-ish');

    const error = await parseFileInWorker(file, { mode: 'file' }).catch((e) => e);

    expect(error).toBeInstanceOf(UnsupportedFileTypeError);
    expect(error.message).toBe("Unsupported file type 'qzx' for file 'payload.qzx'.");
  });

  it('rejects a file whose pages all failed instead of returning an empty successful document', async () => {
    const error = await parseFileInWorker(CORRUPTED_PPTX, { mode: 'file' }).catch((e) => e);

    expect(error).toBeInstanceOf(FileParseError);
    expect(error).toMatchObject({ code: 'LOAD_FAILED' });
  });

  it('names the running parse in the activity registry without a path or content', async () => {
    const parsing = parseFileInWorker(SPARSE_XLSX, { fileId: 'file-activity', mode: 'file' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const live = snapshotActivities().find((activity) => activity.fileId === 'file-activity');
    expect(live).toMatchObject({
      bytes: expect.any(Number),
      fileId: 'file-activity',
      format: 'xlsx',
      kind: 'file-parse',
      phase: 'parsing',
    });
    expect(JSON.stringify(live)).not.toContain(SPARSE_XLSX);

    await parsing;
    const ended = snapshotActivities({ endedWithinMs: 60_000 }).find(
      (activity) => activity.fileId === 'file-activity',
    );
    expect(ended).toMatchObject({ ended: true, kind: 'file-parse' });
  });

  it('fails closed, without parsing on the main thread, when the artifact is missing', async () => {
    const file = await write('fine.txt', 'perfectly parseable');
    const present = process.env[FILE_PARSE_WORKER_PATH_ENV];
    process.env[FILE_PARSE_WORKER_PATH_ENV] = path.join(dir, 'nowhere/fileParseWorker.mjs');
    try {
      const error = await parseFileInWorker(file, { mode: 'file' }).catch((e) => e);

      expect(error).toBeInstanceOf(FileParseError);
      expect(error).toMatchObject({ code: 'UNAVAILABLE' });
    } finally {
      process.env[FILE_PARSE_WORKER_PATH_ENV] = present;
    }
  });
});
