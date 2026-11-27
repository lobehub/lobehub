import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseXLSX } from './xlsx';

const workbookWithPreamble = () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Evaluation export'],
      [],
      ['question', 'expected'],
      ['first', 'one'],
      ['second', 'two'],
    ]),
    'Cases',
  );
  return new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));
};

describe('spreadsheet dataset header selection', () => {
  it('uses the configured header row after a workbook preamble', () => {
    const result = parseXLSX(workbookWithPreamble(), { headerRow: 2 });
    expect(result.headers).toEqual(['question', 'expected']);
    expect(result.rows).toEqual([
      { question: 'first', expected: 'one' },
      { question: 'second', expected: 'two' },
    ]);
    expect(result.totalCount).toBe(2);
  });

  it('counts only data rows while applying the preview limit', () => {
    const result = parseXLSX(workbookWithPreamble(), { headerRow: 2, preview: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.totalCount).toBe(2);
    expect(result.metadata?.sheetName).toBe('Cases');
  });

  it.each([-1, 1.5, Number.NaN])('rejects an invalid header row %s', (headerRow) => {
    expect(() => parseXLSX(workbookWithPreamble(), { headerRow })).toThrow('headerRow');
  });
});
