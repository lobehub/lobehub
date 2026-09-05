import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { editXlsx, exportXlsx, loadXlsx } from './xlsxOperations';

const fixture = async () => {
  const workbook = new ExcelJS.Workbook();
  const sales = workbook.addWorksheet('Sales');
  sales.addRows([
    ['Item', 'Qty', 'Price', 'Total'],
    ['Alpha', 2, 10, { formula: 'B2*C2', result: 20 }],
    ['Beta', 3, 5, { formula: 'B3*C3', result: 15 }],
    ['Grand total', null, null, { formula: 'SUM(D2:D3)', result: 35 }],
  ]);
  sales.getColumn(3).numFmt = '$#,##0.00';
  sales.getRow(1).font = { bold: true };
  const assumptions = workbook.addWorksheet('Assumptions');
  assumptions.addRows([['Tax rate'], [0.1]]);
  return exportXlsx(workbook);
};

describe('xlsxOperations lifecycle', () => {
  it('preserves and recalculates formulas, data, formats, and multiple sheets after export/reopen', async () => {
    let bytes = await fixture();
    bytes = await editXlsx(bytes, {
      range: 'B2:C2',
      sheet: 'Sales',
      type: 'setCells',
      values: [[4, 12.5]],
    });
    bytes = await editXlsx(bytes, { at: 3, sheet: 'Sales', type: 'insertRows' });
    bytes = await editXlsx(bytes, { at: 3, sheet: 'Sales', type: 'deleteRows' });
    bytes = await editXlsx(bytes, { at: 2, sheet: 'Sales', type: 'insertColumns' });
    bytes = await editXlsx(bytes, { at: 2, sheet: 'Sales', type: 'deleteColumns' });
    bytes = await editXlsx(bytes, {
      from: 'A3:D3',
      sheet: 'Sales',
      to: 'A5:D5',
      type: 'copyRange',
    });
    bytes = await editXlsx(bytes, {
      range: 'A5:A5',
      sheet: 'Sales',
      type: 'setCells',
      values: [['Gamma']],
    });
    bytes = await editXlsx(bytes, {
      range: 'D2',
      sheet: 'Sales',
      style: { bold: true, fill: '#FFF2CC', numberFormat: '$#,##0.00' },
      type: 'setStyle',
    });
    bytes = await editXlsx(bytes, { name: 'Notes', type: 'addSheet' });
    bytes = await editXlsx(bytes, { name: 'Notes', newName: 'Archive', type: 'renameSheet' });
    bytes = await editXlsx(bytes, { fromIndex: 2, toIndex: 0, type: 'moveSheet' });

    const reopened = await loadXlsx(bytes);
    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual([
      'Archive',
      'Sales',
      'Assumptions',
    ]);
    expect(reopened.getWorksheet('Sales')?.getCell('B2').value).toBe(4);
    expect(reopened.getWorksheet('Sales')?.getCell('C2').value).toBe(12.5);
    expect(reopened.getWorksheet('Sales')?.getCell('D2').value).toEqual({
      formula: 'B2*C2',
      result: 50,
    });
    expect(reopened.getWorksheet('Sales')?.getCell('D4').value).toEqual({
      formula: 'SUM(D2:D3)',
      result: 65,
    });
    expect(reopened.getWorksheet('Sales')?.getCell('A5').value).toBe('Gamma');
    expect(reopened.getWorksheet('Sales')?.getCell('D2').numFmt).toBe('$#,##0.00');
    expect(reopened.getWorksheet('Sales')?.getCell('D2').font.bold).toBe(true);
    expect(reopened.getWorksheet('Sales')?.getCell('D2').fill).toMatchObject({
      fgColor: { argb: 'FFF2CC' },
    });
    expect(bytes.byteLength).toBeGreaterThan(5_000);
  });

  it('supports cross-sheet references and rejects deleting the last worksheet', async () => {
    let bytes = await fixture();
    bytes = await editXlsx(bytes, {
      range: 'E2',
      sheet: 'Sales',
      type: 'setCells',
      values: [["='Assumptions'!A2*D2"]],
    });
    const reopened = await loadXlsx(bytes);
    expect(reopened.getWorksheet('Sales')?.getCell('E2').value).toEqual({
      formula: "'Assumptions'!A2*D2",
      result: 2,
    });

    const single = new ExcelJS.Workbook();
    single.addWorksheet('Only');
    await expect(
      editXlsx(await exportXlsx(single), { name: 'Only', type: 'deleteSheet' }),
    ).rejects.toThrow('at least one');
  });

  it('moves formula references with inserted rows and columns without changing results', async () => {
    let bytes = await fixture();
    bytes = await editXlsx(bytes, { at: 3, sheet: 'Sales', type: 'insertRows' });
    let reopened = await loadXlsx(bytes);
    expect(reopened.getWorksheet('Sales')?.getCell('D4').value).toEqual({
      formula: 'B4*C4',
      result: 15,
    });
    expect(reopened.getWorksheet('Sales')?.getCell('D5').value).toEqual({
      formula: 'SUM(D2:D4)',
      result: 35,
    });

    bytes = await editXlsx(bytes, { at: 2, sheet: 'Sales', type: 'insertColumns' });
    reopened = await loadXlsx(bytes);
    expect(reopened.getWorksheet('Sales')?.getCell('E2').value).toEqual({
      formula: 'C2*D2',
      result: 20,
    });
    expect(reopened.getWorksheet('Sales')?.getCell('E4').value).toEqual({
      formula: 'C4*D4',
      result: 15,
    });
  });

  it('writes and clears non-contiguous areas and copies cells and rectangular regions', async () => {
    let bytes = await fixture();
    bytes = await editXlsx(bytes, {
      areas: [
        { range: 'A8', values: [['North']] },
        { range: 'C8:D8', values: [[120, 240]] },
        { range: 'F8', values: [[0.3]] },
      ],
      sheet: 'Sales',
      type: 'setAreas',
    });
    bytes = await editXlsx(bytes, { from: 'B2', sheet: 'Sales', to: 'H2', type: 'copyRange' });
    bytes = await editXlsx(bytes, {
      from: 'B2:C3',
      sheet: 'Sales',
      to: 'H5:I6',
      type: 'copyRange',
    });
    let reopened = await loadXlsx(bytes);
    expect(
      ['A8', 'B8', 'C8', 'D8', 'E8', 'F8'].map(
        (address) => reopened.getWorksheet('Sales')?.getCell(address).value,
      ),
    ).toEqual(['North', null, 120, 240, null, 0.3]);
    expect(reopened.getWorksheet('Sales')?.getCell('H2').value).toBe(2);
    expect(
      ['H5', 'I5', 'H6', 'I6'].map(
        (address) => reopened.getWorksheet('Sales')?.getCell(address).value,
      ),
    ).toEqual([2, 10, 3, 5]);

    bytes = await editXlsx(bytes, {
      from: 'B2:C3',
      sheet: 'Sales',
      to: 'A5:B6',
      toSheet: 'Assumptions',
      type: 'copyRange',
    });
    reopened = await loadXlsx(bytes);
    expect(
      ['A5', 'B5', 'A6', 'B6'].map(
        (address) => reopened.getWorksheet('Assumptions')?.getCell(address).value,
      ),
    ).toEqual([2, 10, 3, 5]);

    bytes = await editXlsx(bytes, {
      ranges: ['A8', 'C8:D8', 'F8'],
      sheet: 'Sales',
      type: 'clearAreas',
    });
    reopened = await loadXlsx(bytes);
    expect(
      ['A8', 'B8', 'C8', 'D8', 'E8', 'F8'].map(
        (address) => reopened.getWorksheet('Sales')?.getCell(address).value,
      ),
    ).toEqual([null, null, null, null, null, null]);
  });
});
