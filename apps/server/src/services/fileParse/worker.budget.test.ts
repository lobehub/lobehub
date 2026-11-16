import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileParseBudgetError, isFileParseBudgetError } from '@lobechat/file-loaders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestZip } from '../../../../../packages/file-loaders/src/loaders/excel/testUtils';
import { buildFileParseWorker } from '../../../../../scripts/buildFileParseWorker.mjs';
import { FILE_PARSE_WORKER_PATH_ENV } from './artifact';
import { parseDatasetInWorker, parseFileInWorker } from './index';

// Real built artifact, real threads: the Excel budget refusals must survive the thread boundary
// with reason / limit / actual, and a dataset xlsx must not reach SheetJS without the zip preflight
// however its format is named or detected.
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const WORKSHEET_LIMIT = 256 * 1024 * 1024;
const OVERSIZED_SHEET_DECLARATION = 300 * 1024 * 1024;

let dir: string;
let oversizedSheetZip: Buffer;
let smallXlsx: Buffer;
const previousEnv = process.env[FILE_PARSE_WORKER_PATH_ENV];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'file-parse-budget-'));
  process.env[FILE_PARSE_WORKER_PATH_ENV] = await buildFileParseWorker({
    outdir: path.join(dir, 'artifact'),
  });

  // A tiny archive whose central directory declares a 300 MiB worksheet: refused by the preflight
  // from the declaration alone, before anything is inflated.
  oversizedSheetZip = buildTestZip([
    {
      data: '<x/>',
      declaredSize: OVERSIZED_SHEET_DECLARATION,
      deflate: true,
      name: 'xl/worksheets/sheet1.xml',
    },
  ]);

  const XLSX = createRequire(here('../../../../../packages/file-loaders/package.json'))('xlsx');
  smallXlsx = XLSX.write(
    {
      SheetNames: ['S'],
      Sheets: { S: { '!ref': 'A1:A2', 'A1': { t: 's', v: 'q' }, 'A2': { t: 's', v: 'a' } } },
    },
    { bookType: 'xlsx', type: 'buffer' },
  );
}, 60_000);

afterAll(async () => {
  if (previousEnv === undefined) delete process.env[FILE_PARSE_WORKER_PATH_ENV];
  else process.env[FILE_PARSE_WORKER_PATH_ENV] = previousEnv;
  await rm(dir, { force: true, recursive: true });
});

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the parse to reject');
};

const expectSheetBudget = (error: unknown) => {
  expect(isFileParseBudgetError(error)).toBe(true);
  expect(error).toBeInstanceOf(FileParseBudgetError);
  expect(error).toMatchObject({
    actual: OVERSIZED_SHEET_DECLARATION,
    limit: WORKSHEET_LIMIT,
    reason: 'sheet-xml',
  });
};

describe('file parse worker budget refusals', () => {
  it('restores the budget error of a file parse with reason, limit and actual', async () => {
    const file = path.join(dir, 'huge-sheet.xlsx');
    await writeFile(file, oversizedSheetZip);

    expectSheetBudget(await rejection(parseFileInWorker(file, { mode: 'file' })));
    expectSheetBudget(await rejection(parseFileInWorker(file, { mode: 'document' })));
  });

  it.each([
    ['an explicit xlsx format', { format: 'xlsx' as const }],
    ['the .xlsx file name with format auto', { filename: 'data.xlsx', format: 'auto' as const }],
    ['the legacy .xls file name', { filename: 'data.xls' }],
    ['byte detection with no name and no format', {}],
  ])('runs the zip preflight on a dataset chosen by %s', async (_, options) => {
    const error = await rejection(parseDatasetInWorker(oversizedSheetZip, options));

    expectSheetBudget(error);
  });

  it('still parses an ordinary xlsx dataset', async () => {
    const result = await parseDatasetInWorker<{ totalCount: number }>(smallXlsx, {
      format: 'auto',
    });

    expect(result.totalCount).toBe(1);
  });
});
