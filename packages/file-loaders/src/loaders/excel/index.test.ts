import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

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

  it('should handle Excel file with only headers', async () => {
    const onlyHeaderFile = fixturePath('only-header.xlsx');
    const pages = await loader.loadPages(onlyHeaderFile);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].pageContent).toBeTruthy(); // Should contain header content
    expect(pages).toMatchSnapshot('only_header_pages');
  });
});
