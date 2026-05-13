// @vitest-environment node
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { PptxLoader } from './index';

// Import PptxLoader

// Ensure you have placed a test.pptx file in the fixtures directory
// This PPTX file should ideally contain multiple slides for testing
const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

let loader: FileLoaderInterface;

const testFile = fixturePath('test.pptx'); // Use .pptx
const nonExistentFile = fixturePath('nonexistent.pptx'); // Use .pptx

beforeEach(() => {
  loader = new PptxLoader(); // Instantiate PptxLoader
});

describe('PptxLoader', () => {
  // Describe PptxLoader
  it('should load pages correctly from a PPTX file (one page per slide)', async () => {
    const pages = await loader.loadPages(testFile);
    // There should be one page per slide in the PPTX file
    expect(pages.length).toBeGreaterThan(1);

    // Run a snapshot test directly on the entire pages array (includes slideNumber)
    expect(pages).toMatchSnapshot();
  });

  it('should aggregate content correctly (joining slides)', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // Default aggregation joins slide contents with newlines
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // Returns one page containing error info even on failure
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load or process PPTX file:'); // Update error message check
  });

  it('should handle corrupted slide XML', async () => {
    const corruptedFile = fixturePath('corrupted-slides.pptx');
    const pages = await loader.loadPages(corruptedFile);
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('All slides failed to parse correctly');
  });

  it('should handle aggregateContent with all error pages', async () => {
    const corruptedFile = fixturePath('corrupted-slides.pptx');
    const pages = await loader.loadPages(corruptedFile);
    const content = await loader.aggregateContent(pages);
    expect(content).toBe(''); // Returns empty string when all pages are error pages
  });

  it('should handle empty PPTX file with no slides', async () => {
    const emptyFile = fixturePath('empty-slides.pptx');
    const pages = await loader.loadPages(emptyFile);
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain(
      'No slides found. The PPTX file might be empty, corrupted, or does not contain standard slide XMLs.',
    );
  });
});
