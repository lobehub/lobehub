// @vitest-environment node
import { Workbook } from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import { ChunkingLoader } from '../../index';
import { ExcelLoader } from '../index';

const buildWorkbook = async () => {
  const workbook = new Workbook();

  const pricing = workbook.addWorksheet('Pricing');
  pricing.addRow(['Plan', 'Discount']);
  pricing.addRow(['Basic', '10%']);
  pricing.addRow(['Pro', '20%']);

  const notes = workbook.addWorksheet('Notes');
  notes.addRow(['Owner', 'Signed']);
  notes.addRow(['Alice', '2026-10-07']);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
};

describe('ExcelLoader', () => {
  it('should chunk every sheet row into a header/value document', async () => {
    const data = await ExcelLoader(new Blob([Buffer.from(await buildWorkbook())]));

    expect(data).toHaveLength(3);
    expect(data[0].metadata).toMatchObject({ row: 2, sheetName: 'Pricing', source: 'blob' });
    expect(data[0].pageContent).toBe('Plan: Basic\nDiscount: 10%');
    expect(data[1].pageContent).toBe('Plan: Pro\nDiscount: 20%');
    expect(data[2].metadata.sheetName).toBe('Notes');
    expect(data[2].pageContent).toBe('Owner: Alice\nSigned: 2026-10-07');
  });

  it('normalizes cell values and skips empty sheets and rows', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Empty');
    const sheet = workbook.addWorksheet('Values');
    sheet.addRow(['Rich text', 'Formula', 'Link', 'Date', 'Number', 'Boolean', 'Error', '']);
    sheet.addRow([
      { richText: [{ text: 'Hello ' }, { text: 'world' }] },
      { formula: '1+1', result: 2 },
      { text: 'Website', hyperlink: 'https://example.com' },
      new Date('2026-10-07T00:00:00Z'),
      0,
      false,
      { error: '#DIV/0!' },
      'Extra',
    ]);
    sheet.addRow(['   ']);
    const chunks = await ExcelLoader(new Blob([Buffer.from(await workbook.xlsx.writeBuffer())]));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageContent).toBe(
      'Rich text: Hello world\nFormula: 2\nLink: Website\nDate: 2026-10-07\nNumber: 0\nBoolean: false\nError: #DIV/0!\ncolumn 8: Extra',
    );
  });

  it('uses populated columns without querying the worksheet width', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sparse');
    sheet.getCell('A1').value = 'Name';
    sheet.getCell('XFD1').value = 'Amount';
    sheet.getCell('A2').value = 'Alice';
    sheet.getCell('XFD2').value = 42;
    sheet.getCell('XFC3').value = 'No header';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const columnCount = vi.spyOn(Object.getPrototypeOf(sheet), 'columnCount', 'get');

    try {
      const chunks = await ExcelLoader(new Blob([bytes]));

      expect(chunks.map((chunk) => chunk.pageContent)).toEqual([
        'Name: Alice\nAmount: 42',
        'column 16383: No header',
      ]);
      expect(chunks[1].metadata.row).toBe(3);
      expect(columnCount).not.toHaveBeenCalled();
    } finally {
      columnCount.mockRestore();
    }
  });

  it('uses the first non-empty row as headers and preserves physical row numbers', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Leading blanks');
    sheet.getCell('B2').value = 'Plan';
    sheet.getCell('D2').value = 'Price';
    sheet.getCell('B4').value = 'Pro';
    sheet.getCell('D4').value = 20;

    const chunks = await ExcelLoader(new Blob([Buffer.from(await workbook.xlsx.writeBuffer())]));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageContent).toBe('Plan: Pro\nPrice: 20');
    expect(chunks[0].metadata).toMatchObject({ row: 4, sheetName: 'Leading blanks' });
  });

  it('reports malformed workbooks through the chunking error boundary', async () => {
    await expect(
      new ChunkingLoader().partitionContent('broken.xlsx', new TextEncoder().encode('invalid')),
    ).rejects.toMatchObject({ name: 'DocumentLoaderError' });
  });

  /**
   * Regression: `.xlsx` used to fall through `getType` and the whole file failed
   * with `Unsupported file type [undefined]`, so nothing was ever indexed.
   */
  it('should be reachable through ChunkingLoader for .xlsx', async () => {
    const chunks = await new ChunkingLoader().partitionContent(
      'pricing.xlsx',
      await buildWorkbook(),
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0].pageContent).toBe('Plan: Basic\nDiscount: 10%');
  });
});
