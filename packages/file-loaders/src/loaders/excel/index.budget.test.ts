import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as xlsx from 'xlsx';

import { loadFile } from '../../loadFile';
import { ExcelLoader } from './index';
import { buildTestZip } from './testUtils';

let dir: string;
let loader: ExcelLoader;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'excel-budget-'));
  loader = new ExcelLoader();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { force: true, recursive: true });
});

const writeBook = async (name: string, sheets: Record<string, xlsx.WorkSheet>): Promise<string> => {
  const workbook = xlsx.utils.book_new();
  for (const [sheetName, sheet] of Object.entries(sheets)) {
    xlsx.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  const filePath = path.join(dir, name);
  await writeFile(filePath, xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
  return filePath;
};

const refArea = (ref: string) => {
  const range = xlsx.utils.decode_range(ref);
  return (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
};

describe('ExcelLoader data bounds', () => {
  it('hands sheet_to_json a range shrunk to the real data when a huge range is declared', async () => {
    const sheet = xlsx.utils.aoa_to_sheet([
      ['name', 'value'],
      ['a', 0],
      ['b', false],
    ]);
    sheet['!ref'] = 'A1:Z50000';
    const filePath = await writeBook('declared.xlsx', { Declared: sheet });
    const toJson = vi.spyOn(xlsx.utils, 'sheet_to_json').mockReturnValue([]);

    await loader.loadPages(filePath);

    const received = toJson.mock.calls[0][0] as xlsx.WorkSheet;
    expect(refArea(received['!ref']!)).toBeLessThanOrEqual(6);
  }, 30_000);

  it('keeps the markdown for values 0 / false and drops declared blank rows', async () => {
    const sheet = xlsx.utils.aoa_to_sheet([
      ['name', 'value'],
      ['a', 0],
      ['b', false],
    ]);
    sheet['!ref'] = 'A1:Z3000';

    const pages = await loader.loadPages(await writeBook('zero.xlsx', { Zero: sheet }));

    expect(pages[0].pageContent).toBe('| name | value |\n| --- | --- |\n| a | 0 |\n| b | FALSE |');
  });

  it('turns a sheet with no real cells into the empty placeholder', async () => {
    const sheet: xlsx.WorkSheet = { '!ref': 'A1:Z3000' };
    const filePath = await writeBook('blank.xlsx', { Blank: sheet });
    const toJson = vi.spyOn(xlsx.utils, 'sheet_to_json');

    const pages = await loader.loadPages(filePath);

    expect(pages[0].pageContent).toBe('*Sheet is empty or contains no data.*');
    expect(refArea((toJson.mock.calls[0][0] as xlsx.WorkSheet)['!ref']!)).toBe(1);
  });

  it('loads an large declared range with a real 3150 x 8 sheet completely', async () => {
    const rows = [
      Array.from({ length: 8 }, (_, c) => `h${c}`),
      ...Array.from({ length: 3149 }, (_, r) => Array.from({ length: 8 }, (_, c) => `${r}-${c}`)),
    ];
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet['!ref'] = 'A1:AX30000';

    const pages = await loader.loadPages(await writeBook('big.xlsx', { Big: sheet }));

    expect(pages[0].metadata.error).toBeUndefined();
    expect(pages[0].lineCount).toBe(3150 + 1);
    expect(pages[0].pageContent).toContain('| 3148-0 |');
    expect(pages[0].pageContent).toContain('3148-7 |');
  });

  it('processes every sheet of a multi-sheet workbook independently', async () => {
    const sparse = xlsx.utils.aoa_to_sheet([
      ['k', 'v'],
      ['x', 1],
    ]);
    sparse['!ref'] = 'A1:Z5000';
    const normal = xlsx.utils.aoa_to_sheet([
      ['p', 'q'],
      ['y', 2],
    ]);

    const pages = await loader.loadPages(
      await writeBook('multi.xlsx', { Normal: normal, Sparse: sparse }),
    );

    expect(pages.map((page) => page.metadata.sheetName)).toEqual(['Normal', 'Sparse']);
    expect(pages[1].pageContent).toBe('| k | v |\n| --- | --- |\n| x | 1 |');
    expect(pages[0].pageContent).toBe('| p | q |\n| --- | --- |\n| y | 2 |');
  });

  it('rejects with a budget error when real values span an over-budget rectangle', async () => {
    const sheet: xlsx.WorkSheet = {
      '!ref': 'A1:CCC3000',
      'A1': { t: 's', v: 'head' },
      'CCC3000': { t: 's', v: 'tail' },
    };
    const filePath = await writeBook('diagonal.xlsx', { Diagonal: sheet });

    await expect(loader.loadPages(filePath)).rejects.toMatchObject({
      name: 'FileParseBudgetError',
      reason: 'sheet-cells',
    });
  });
});

describe('ExcelLoader zip budget', () => {
  it('rejects an archive with too many entries before parsing it', async () => {
    const filePath = path.join(dir, 'many.xlsx');
    await writeFile(
      filePath,
      buildTestZip(Array.from({ length: 5001 }, (_, i) => ({ name: `xl/media/${i}.bin` }))),
    );

    await expect(loader.loadPages(filePath)).rejects.toMatchObject({
      actual: 5001,
      limit: 5000,
      name: 'FileParseBudgetError',
      reason: 'zip-entries',
    });
  });

  it('still reports a corrupt archive through the usual error page', async () => {
    const filePath = path.join(dir, 'corrupt.xlsx');
    await writeFile(filePath, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)]));

    const pages = await loader.loadPages(filePath);

    expect(pages).toHaveLength(1);
    expect(pages[0].metadata.error).toContain('Failed to load Excel file');
  });
});

describe('loadFile with budget errors', () => {
  it('rethrows the budget error instead of turning it into an error page', async () => {
    const filePath = path.join(dir, 'many.xlsx');
    await writeFile(
      filePath,
      buildTestZip(Array.from({ length: 5001 }, (_, i) => ({ name: `xl/media/${i}.bin` }))),
    );

    await expect(loadFile(filePath)).rejects.toMatchObject({
      name: 'FileParseBudgetError',
      reason: 'zip-entries',
    });
  });

  it('keeps ordinary excel failures as an error page', async () => {
    const filePath = path.join(dir, 'corrupt.xlsx');
    await writeFile(filePath, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)]));

    const doc = await loadFile(filePath);

    expect(doc.metadata.error).toContain('Failed to load Excel file');
  });
});
