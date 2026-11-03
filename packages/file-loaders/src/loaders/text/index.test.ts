import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { TextLoader } from './index';

const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

let loader: FileLoaderInterface;

const testFile = fixturePath('test.txt');

beforeEach(() => {
  loader = new TextLoader();
});

describe('TextLoader', () => {
  it('should load pages correctly', async () => {
    const pages = await loader.loadPages(testFile);
    expect(pages).toHaveLength(1);
    const page = pages[0];
    expect(page).toMatchSnapshot();
  });

  it('should aggregate content correctly', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // Default aggregation joins with newline
    expect(content).toBe('Hello Text.\nSecond Line.\n');
  });

  it('should load UTF-16LE file correctly', async () => {
    const pages = await loader.loadPages(fixturePath('test-utf16le.csv'));
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('Hello UTF-16LE.\nSecond Line.\n');
  });

  it('should load UTF-16BE file correctly', async () => {
    const pages = await loader.loadPages(fixturePath('test-utf16be.csv'));
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('Hello UTF-16BE.\nSecond Line.\n');
  });

  it('should load UTF-8 file with BOM correctly', async () => {
    const pages = await loader.loadPages(fixturePath('test-utf8-bom.txt'));
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('Hello UTF-8 BOM.\nSecond Line.\n');
  });

  it('should detect UTF-16LE without BOM via heuristic', async () => {
    const pages = await loader.loadPages(fixturePath('test-utf16le-nobom.csv'));
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('Hello UTF-16LE.\nSecond Line.\n');
  });

  it('should detect UTF-16BE without BOM via heuristic', async () => {
    const pages = await loader.loadPages(fixturePath('test-utf16be-nobom.csv'));
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('Hello UTF-16BE.\nSecond Line.\n');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(fixturePath('nonexistent.txt'));
    expect(pages).toHaveLength(1);
    expect(pages[0].metadata.error).toContain('Failed to load text file');
    expect(pages[0].pageContent).toBe('');
  });
});
