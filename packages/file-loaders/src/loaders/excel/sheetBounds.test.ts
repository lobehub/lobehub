import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import { clampSheetRefToData, MAX_SHEET_CELLS } from './sheetBounds';

const sheetWith = (ref: string, cells: Record<string, xlsx.CellObject>): xlsx.WorkSheet => ({
  '!ref': ref,
  ...cells,
});

describe('clampSheetRefToData', () => {
  it('shrinks the end of a stretched range to the last real cell and keeps the start', () => {
    const ws = sheetWith('B2:ZZ99999', {
      C5: { t: 's', v: 'x' },
      D7: { t: 'n', v: 1 },
    });

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('B2:D7');
  });

  it('does not walk the declared rectangle (a declared XFD1048576 range with two cells)', () => {
    const ws = sheetWith('A1:XFD1048576', {
      A1: { t: 's', v: 'head' },
      C3: { t: 's', v: 'tail' },
    });

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('A1:C3');
  });

  it.each([
    ['zero', { t: 'n', v: 0 } as xlsx.CellObject],
    ['false', { t: 'b', v: false } as xlsx.CellObject],
    ['date', { t: 'd', v: new Date(0) } as xlsx.CellObject],
    ['error', { t: 'e', v: 0x07, w: '#DIV/0!' } as xlsx.CellObject],
    ['formula cached value', { f: 'A1+1', t: 'n', v: 2 } as xlsx.CellObject],
    ['formula without cache', { f: 'A1+1', t: 'n' } as xlsx.CellObject],
    ['empty string', { t: 's', v: '' } as xlsx.CellObject],
  ])('treats a far %s cell as real data', (_name, cell) => {
    const ws = sheetWith('A1:Z5000', { A1: { t: 's', v: 'head' }, E40: cell });

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('A1:E40');
  });

  it('ignores style-only stub cells', () => {
    const ws = sheetWith('A1:Z5000', {
      A1: { t: 's', v: 'head' },
      D100: { t: 'z' },
      E200: { t: 'z', s: { bold: true } } as xlsx.CellObject,
    });

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('A1');
  });

  it('collapses a sheet without any real cell to its start cell', () => {
    const ws = sheetWith('C4:Z5000', { '!margins': {} as any, 'D9': { t: 'z' } });

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('C4');
    expect(xlsx.utils.sheet_to_json(ws)).toEqual([]);
  });

  it('never extends the range to cells outside the declared one', () => {
    const ws = sheetWith('A1:C3', { A1: { t: 's', v: 'h' }, Z99: { t: 's', v: 'outside' } });

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('A1');
  });

  it('leaves a sheet without !ref untouched', () => {
    const ws: xlsx.WorkSheet = { A1: { t: 's', v: 'x' } };

    expect(() => clampSheetRefToData(ws)).not.toThrow();
    expect(ws['!ref']).toBeUndefined();
  });

  it('keeps sheet_to_json output identical for a normal dense sheet', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['name', 'value'],
      ['a', 0],
      ['b', false],
    ]);
    const before = xlsx.utils.sheet_to_json(ws, { defval: '', raw: false });

    clampSheetRefToData(ws);

    expect(xlsx.utils.sheet_to_json(ws, { defval: '', raw: false })).toEqual(before);
  });

  it('accepts a 3150 x 8 data area declared as a million-row range', () => {
    const rows = Array.from({ length: 3150 }, (_, r) => Array.from({ length: 8 }, (_, c) => r + c));
    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws['!ref'] = 'A1:AX1046048';

    clampSheetRefToData(ws);

    expect(ws['!ref']).toBe('A1:H3150');
  });

  it('rejects a real-data rectangle above the cell budget without leaking cell content', () => {
    const ws = sheetWith('A1:ZZ9999', {
      A1: { t: 's', v: 'SECRET-HEAD' },
      J20: { t: 's', v: 'SECRET-TAIL' },
    });

    let caught: any;
    try {
      clampSheetRefToData(ws, { maxCells: 100 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      actual: 200,
      limit: 100,
      name: 'FileParseBudgetError',
      reason: 'sheet-cells',
    });
    expect(caught.message).not.toContain('SECRET');
  });

  it('allows a rectangle exactly at the budget', () => {
    const ws = sheetWith('A1:Z100', { A1: { t: 's', v: 'h' }, J10: { t: 's', v: 't' } });

    expect(() => clampSheetRefToData(ws, { maxCells: 100 })).not.toThrow();
  });

  it('defaults to a 5,000,000 cell budget', () => {
    expect(MAX_SHEET_CELLS).toBe(5_000_000);
  });
});
