import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import type { FileLoaderInterface } from '../../types';
import { ExcelLoader } from './index';

// Ensure you have placed a test.xlsx file in the fixtures directory
// This Excel file should ideally contain multiple worksheets (sheets) for testing
const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

let loader: FileLoaderInterface;

const testFile = fixturePath('test.xlsx');
const nonExistentFile = fixturePath('nonexistent.xlsx');

beforeEach(() => {
  loader = new ExcelLoader();
});

describe('ExcelLoader', () => {
  it('should load pages correctly from an Excel file (one page per sheet)', async () => {
    const pages = await loader.loadPages(testFile);
    // There should be one page per sheet in the Excel file
    expect(pages.length).toBeGreaterThan(0);

    // Run a snapshot test directly on the entire pages array
    expect(pages).toMatchSnapshot();

    // If your test.xlsx has multiple sheets, you can add more assertions
    // e.g., check the sheetName in a specific sheet's metadata
    // expect(pages[1].metadata.sheetName).toBe('Sheet2');
  });

  it('should aggregate content correctly (joining sheets)', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // Default aggregation joins sheet contents with newlines
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // Returns one page containing error info even on failure
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load Excel file');
  });

  it('writes a long whole number in full instead of in scientific notation', async () => {
    // Excel's General format shows a number past 11 digits as 1.23457E+12, and
    // an order number or phone number read that way has lost its digits.
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['order', 'phone', 'ratio', 'tiny', 'scientific'],
      [1234567890123, 8613812345678, 0.1 + 0.2, 1.5e-10, 1234567890123],
    ]);
    // A format the author chose is kept as it is.
    worksheet['E2'].z = '0.00E+00';
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Orders');
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'excel-loader-')), 'orders.xlsx');
    await writeFile(file, xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }));

    const [page] = await loader.loadPages(file);

    expect(page.pageContent).toContain(
      '| 1234567890123 | 8613812345678 | 0.3 | 1.5E-10 | 1.23E+12 |',
    );
  });

  it('should handle Excel file with only headers', async () => {
    const onlyHeaderFile = fixturePath('only-header.xlsx');
    const pages = await loader.loadPages(onlyHeaderFile);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].pageContent).toBeTruthy(); // Should contain header content
    expect(pages).toMatchSnapshot('only_header_pages');
  });
});
