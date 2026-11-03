// @vitest-environment node
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { PdfLoader } from './index';

// Ensure you have placed a test.pdf file in the fixtures directory
const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

let loader: FileLoaderInterface;

const testFile = fixturePath('test.pdf');
const nonExistentFile = fixturePath('nonexistent.pdf');

beforeEach(() => {
  loader = new PdfLoader();
});

describe('PdfLoader', () => {
  it('should load pages correctly from a PDF file', async () => {
    const pages = await loader.loadPages(testFile);

    expect(pages.length).toBeGreaterThan(0);

    expect(pages).toMatchSnapshot();
  });

  it('should aggregate content correctly', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // Default aggregation joins page contents with newlines
    expect(content).toMatchSnapshot();
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // Returns one page containing error info even on failure
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load or parse PDF file:');
  });

  it('should attach document metadata correctly', async () => {
    // First load pages to initialize pdfInstance, even though this method does not use them directly
    await loader.loadPages(testFile);
    const metadata = await loader.attachDocumentMetadata!(testFile);

    expect(metadata).toMatchSnapshot();
  });
});
