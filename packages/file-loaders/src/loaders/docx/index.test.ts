import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { DocxLoader } from './index';

const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

let loader: FileLoaderInterface;

const testFile = fixturePath('test.docx');
const nonExistentFile = fixturePath('nonexistent.docx');

beforeEach(() => {
  loader = new DocxLoader();
});

describe('DocxLoader', () => {
  it('should load pages correctly from a DOCX file', async () => {
    const pages = await loader.loadPages(testFile);
    // DOCX files are typically loaded as a single page
    expect(pages).toHaveLength(1);
    expect(pages).toMatchSnapshot();
  });

  it('should aggregate content correctly', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // For single-page documents, aggregated content should equal the page content
    expect(content).toEqual(pages[0].pageContent);
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // Returns one page containing error info even on failure
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load DOCX file');
  });
});
