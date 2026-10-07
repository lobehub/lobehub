// @vitest-environment node
import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';

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
