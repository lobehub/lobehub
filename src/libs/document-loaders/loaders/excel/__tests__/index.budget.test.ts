// @vitest-environment node
import { FileParseBudgetError } from '@lobechat/file-loaders';
import { buildTestZip } from '@lobechat/file-loaders/src/loaders/excel/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());

// exceljs is the memory-heavy step: the budget must refuse before it is ever constructed.
vi.mock('exceljs', () => ({
  Workbook: class {
    xlsx = { load };
    worksheets = [];
  },
}));

const { ChunkingLoader } = await import('../../index');
const { ExcelLoader } = await import('../index');

afterEach(() => vi.clearAllMocks());

const oversizedSheetZip = () =>
  buildTestZip([
    {
      data: '<worksheet/>',
      declaredSize: 300 * 1024 * 1024,
      deflate: true,
      name: 'xl/worksheets/sheet1.xml',
    },
  ]);

describe('ExcelLoader zip budget', () => {
  it('refuses an over-budget archive before exceljs loads anything', async () => {
    const error = await ExcelLoader(new Blob([oversizedSheetZip()])).catch((e) => e);

    expect(error).toBeInstanceOf(FileParseBudgetError);
    expect(error).toMatchObject({ reason: 'sheet-xml' });
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the budget error typed through the chunking error boundary', async () => {
    const error = await new ChunkingLoader()
      .partitionContent('bomb.xlsx', new Uint8Array(oversizedSheetZip()))
      .catch((e) => e);

    expect(error).toMatchObject({ name: 'FileParseBudgetError', reason: 'sheet-xml' });
    expect(load).not.toHaveBeenCalled();
  });

  it('lets an archive within budget through to exceljs', async () => {
    load.mockResolvedValue(undefined);
    const small = buildTestZip([{ data: '<worksheet/>', name: 'xl/worksheets/sheet1.xml' }]);

    await expect(ExcelLoader(new Blob([small]))).resolves.toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
