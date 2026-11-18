import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { parseXLSX } from './xlsx';

const toBuffer = (sheets: Record<string, XLSX.WorkSheet>) => {
  const workbook = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  return new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseXLSX data bounds', () => {
  it('parses a sheet with a stretched declared range to the same rows', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['q', 'a'],
      ['one', 0],
      ['two', false],
    ]);
    sheet['!ref'] = 'A1:Z20000';
    const toJson = vi.spyOn(XLSX.utils, 'sheet_to_json');

    const result = parseXLSX(toBuffer({ Data: sheet }));

    expect(result.headers).toEqual(['q', 'a']);
    expect(result.rows).toEqual([
      { a: '0', q: 'one' },
      { a: 'FALSE', q: 'two' },
    ]);
    expect(result.totalCount).toBe(2);
    const received = toJson.mock.calls[0][0] as XLSX.WorkSheet;
    expect(XLSX.utils.decode_range(received['!ref']!).e.r).toBeLessThan(10);
  });

  it('still selects the sheet by name and by index', () => {
    const first = XLSX.utils.aoa_to_sheet([['a'], ['1']]);
    const second = XLSX.utils.aoa_to_sheet([['b'], ['2']]);
    const buffer = toBuffer({ First: first, Second: second });

    expect(parseXLSX(buffer, { sheet: 'Second' }).rows).toEqual([{ b: '2' }]);
    expect(parseXLSX(buffer, { sheet: 1 }).rows).toEqual([{ b: '2' }]);
  });

  it('throws a budget error when real values span an over-budget rectangle', () => {
    const sheet: XLSX.WorkSheet = {
      '!ref': 'A1:CCC3000',
      'A1': { t: 's', v: 'head' },
      'CCC3000': { t: 's', v: 'tail' },
    };

    expect(() => parseXLSX(toBuffer({ Data: sheet }))).toThrow(
      expect.objectContaining({ name: 'FileParseBudgetError', reason: 'sheet-cells' }),
    );
  });
});
