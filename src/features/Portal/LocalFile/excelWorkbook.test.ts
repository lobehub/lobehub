import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  applyCellFormat,
  calculateFormula,
  moveWorksheet,
  recalculateWorkbook,
  setCellInput,
  spliceWorksheetColumns,
  spliceWorksheetRows,
} from './excelWorkbook';

const fixture = () => {
  const workbook = new Workbook();
  const sales = workbook.addWorksheet('Sales');
  const assumptions = workbook.addWorksheet('Assumptions');
  sales.addRows([
    ['Product', 'Qty', 'Price', 'Revenue', 'Tax'],
    [
      'Alpha',
      4,
      12.5,
      { formula: 'B2*C2', result: 50 },
      { formula: "D2*'Assumptions'!B2", result: 5 },
    ],
    [
      'Beta',
      3,
      5,
      { formula: 'B3*C3', result: 15 },
      { formula: "D3*'Assumptions'!B2", result: 1.5 },
    ],
    ['Total', null, null, { formula: 'SUM(D2:D3)', result: 65 }],
  ]);
  assumptions.addRows([
    ['Input', 'Value'],
    ['Tax rate', 0.1],
  ]);
  return { assumptions, sales, workbook };
};

describe('Excel workbook editing', () => {
  it('calculates common arithmetic, aggregate, and cross-sheet formulas', () => {
    const { sales, workbook } = fixture();

    expect(calculateFormula(workbook, sales, '=B2*C2')).toBe(50);
    expect(calculateFormula(workbook, sales, "=D2*'Assumptions'!B2")).toBe(5);
    expect(calculateFormula(workbook, sales, '=SUM(D2:D3)')).toBe(65);
    expect(calculateFormula(workbook, sales, '=AVERAGE(D2:D3)')).toBe(32.5);
    expect(calculateFormula(workbook, sales, '=MIN(D2:D3)+MAX(D2:D3)+COUNT(D2:D3)')).toBe(67);
  });

  it('recalculates dependents after a cell edit', () => {
    const { sales, workbook } = fixture();

    setCellInput(workbook, sales, 'B2', '5');

    expect(sales.getCell('D2').result).toBe(62.5);
    expect(sales.getCell('E2').result).toBe(6.25);
    expect(sales.getCell('D4').result).toBe(77.5);
  });

  it('keeps formulas aligned when rows and columns are inserted', () => {
    const { sales, workbook } = fixture();

    spliceWorksheetRows(workbook, sales, 3, 0);
    spliceWorksheetColumns(workbook, sales, 2, 0);

    expect(sales.getCell('E2').formula).toBe('C2*D2');
    expect(sales.getCell('E5').formula).toBe('SUM(E2:E4)');
    expect(sales.getCell('E5').result).toBe(65);
  });

  it('preserves values, formulas, results, formats, styles and sheet order across export/reopen', async () => {
    const { sales, workbook } = fixture();
    const archive = workbook.addWorksheet('Notes');
    archive.name = 'Archive';
    moveWorksheet(workbook, 2, 0);
    sales.spliceRows(3, 0, ['Gamma', 2, 10, { formula: 'B3*C3', result: 20 }]);
    sales.spliceColumns(6, 0, [null, 'Margin', 0.2, 0.15, null]);
    applyCellFormat(sales.getCell('D2'), {
      align: 'right',
      bold: true,
      fill: '#DDEBF7',
      numberFormat: '$#,##0.00',
    });
    applyCellFormat(sales.getCell('F2'), { italic: true, numberFormat: '0.0%' });
    recalculateWorkbook(workbook);

    const exported = await workbook.xlsx.writeBuffer();
    const reopened = new Workbook();
    await reopened.xlsx.load(exported);
    const reopenedSales = reopened.getWorksheet('Sales')!;

    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual([
      'Archive',
      'Sales',
      'Assumptions',
    ]);
    expect(reopenedSales.getCell('A3').value).toBe('Gamma');
    expect(reopenedSales.getCell('D3').formula).toBe('B3*C3');
    expect(reopenedSales.getCell('D3').result).toBe(20);
    expect(reopenedSales.getCell('D2').numFmt).toBe('$#,##0.00');
    expect(reopenedSales.getCell('D2').font.bold).toBe(true);
    expect(reopenedSales.getCell('D2').fill).toMatchObject({
      fgColor: { argb: 'FFDDEBF7' },
      pattern: 'solid',
      type: 'pattern',
    });
    expect(reopenedSales.getCell('F2').numFmt).toBe('0.0%');
    expect(new Uint8Array(exported).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  });
});
