import { describe, expect, it } from 'vitest';

import { normalizeSourceUrl } from './draftStorage';
import {
  cellAddress,
  columnName,
  formatCellNumber,
  isInBounds,
  parseCellAddress,
  rangeAddress,
  rangeAnchoredAt,
  rangeBetween,
  rangeSize,
} from './gridUtils';

describe('gridUtils addresses', () => {
  it('round-trips addresses across the AA boundary', () => {
    expect(columnName(1)).toBe('A');
    expect(columnName(26)).toBe('Z');
    expect(columnName(27)).toBe('AA');
    expect(parseCellAddress('AA10')).toEqual({ column: 27, row: 10 });
    expect(cellAddress({ column: 27, row: 10 })).toBe('AA10');
    expect(() => parseCellAddress('10A')).toThrow('Invalid cell address');
  });

  it('normalizes a selection regardless of drag direction', () => {
    const bounds = rangeBetween('C5', 'A2');
    expect(rangeAddress(bounds)).toBe('A2:C5');
    expect(rangeSize(bounds)).toEqual({ columns: 3, rows: 4 });
    expect(rangeAddress(rangeBetween('B2', 'B2'))).toBe('B2');
    expect(isInBounds(bounds, 3, 2)).toBe(true);
    expect(isInBounds(bounds, 6, 2)).toBe(false);
  });

  it('anchors a paste target of the copied size at the selected cell', () => {
    expect(rangeAnchoredAt('D4', { columns: 2, rows: 3 })).toBe('D4:E6');
    expect(rangeAnchoredAt('A1', { columns: 1, rows: 1 })).toBe('A1');
  });
});

describe('gridUtils number formats', () => {
  it('renders the editor formats and leaves unknown formats untouched', () => {
    expect(formatCellNumber(1234.5, '$#,##0.00')).toBe('$1,234.50');
    expect(formatCellNumber(-1234.5, '$#,##0.00')).toBe('-$1,234.50');
    expect(formatCellNumber(0.125, '0.00%')).toBe('12.50%');
    expect(formatCellNumber(9876543.21, '#,##0.00')).toBe('9,876,543.21');
    expect(formatCellNumber(42, 'General')).toBeUndefined();
    expect(formatCellNumber(42, undefined)).toBeUndefined();
    expect(formatCellNumber(42, 'yyyy-mm-dd')).toBeUndefined();
  });
});

describe('draft source url normalization', () => {
  it('ignores rotating presigned query strings but keeps the object path', () => {
    expect(
      normalizeSourceUrl('https://s3.local/bucket/file.xlsx?X-Amz-Signature=abc&X-Amz-Date=1'),
    ).toBe('https://s3.local/bucket/file.xlsx');
    expect(normalizeSourceUrl('https://s3.local/bucket/file.xlsx#frag')).toBe(
      'https://s3.local/bucket/file.xlsx',
    );
    expect(normalizeSourceUrl('/files/abc.xlsx')).toBe('/files/abc.xlsx');
  });
});
