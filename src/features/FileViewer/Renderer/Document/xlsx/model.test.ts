import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';

import { readWorkbook } from './model';

const readWorksheet = async (workbook: Workbook) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const [sheet] = await readWorkbook(new Blob([buffer as BlobPart]));

  return sheet;
};

describe('readWorkbook', () => {
  it('keeps sparse worksheet rows at their physical row positions', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Sparse');

    worksheet.getCell('A1').value = 'first';
    worksheet.getCell('A2').value = 'second';
    worksheet.getCell('A3').value = 'third';
    worksheet.getCell('A4').value = 'fourth';
    worksheet.getCell('A6').value = 'sixth';

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows.map((row) => row.r)).toEqual([1, 2, 3, 4, 6]);
    expect(sheet.rows.at(-1)?.cells[0].t).toBe('sixth');
  });

  it('formats percentage cells by scaling the stored value', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Percent');

    worksheet.getCell('A1').value = 0.15;
    worksheet.getCell('A1').numFmt = '0%';
    worksheet.getCell('A2').value = -0.125;
    worksheet.getCell('A2').numFmt = '0.0%';

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows[0].cells[0].t).toBe('15%');
    expect(sheet.rows[1].cells[0].t).toBe('-12.5%');
  });

  it('honors optional decimal placeholders', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Decimals');

    worksheet.getCell('A1').value = 1.25;
    worksheet.getCell('A1').numFmt = '0.##';
    worksheet.getCell('A2').value = 1.25;
    worksheet.getCell('A2').numFmt = '0.0#';
    worksheet.getCell('A3').value = 1.2;
    worksheet.getCell('A3').numFmt = '0.0#';

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows[0].cells[0].t).toBe('1.25');
    expect(sheet.rows[1].cells[0].t).toBe('1.25');
    expect(sheet.rows[2].cells[0].t).toBe('1.2');
  });

  it('formats scientific notation without fixed-point rounding', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Scientific');

    worksheet.getCell('A1').value = 0.001;
    worksheet.getCell('A1').numFmt = '0.00E+00';
    worksheet.getCell('A2').value = -123_000;
    worksheet.getCell('A2').numFmt = '0.0E+00';

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows[0].cells[0].t).toBe('1.00E-03');
    expect(sheet.rows[1].cells[0].t).toBe('-1.2E+05');
  });

  it('clips merged cell spans to rendered preview rows', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Merges');

    worksheet.getCell('A1').value = 'merged';
    worksheet.mergeCells('A1:A1000');

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows).toHaveLength(500);
    expect(sheet.rows[0].cells[0]).toMatchObject({ rs: 500, t: 'merged' });
  });

  it('formats cached date results from formula cells', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Formula Dates');

    worksheet.getCell('A1').value = { formula: 'DATE(2026,9,8)', result: new Date('2026-09-08') };

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows[0].cells[0].t).toBe('2026-09-08');
  });

  it('selects number format sections for negative and zero values', async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Sections');

    worksheet.getCell('A1').value = -1234;
    worksheet.getCell('A1').numFmt = '$#,##0.00;($#,##0.00);-';
    worksheet.getCell('A2').value = 0;
    worksheet.getCell('A2').numFmt = '$#,##0.00;($#,##0.00);-';

    const sheet = await readWorksheet(workbook);

    expect(sheet.rows[0].cells[0].t).toBe('($1,234.00)');
    expect(sheet.rows[1].cells[0].t).toBe('-');
  });
});
