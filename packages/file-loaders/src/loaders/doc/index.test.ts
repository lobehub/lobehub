import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { DocLoader } from './index';

const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

let loader: FileLoaderInterface;

const testFile = fixturePath('test.doc');
const nonExistentFile = fixturePath('nonexistent.doc');

beforeEach(() => {
  loader = new DocLoader();
});

describe('DocLoader', () => {
  it('should load pages correctly from a DOC file', async () => {
    const pages = await loader.loadPages(testFile);
    expect(pages).toHaveLength(1);
    expect(pages).toMatchSnapshot();
  });

  it('should aggregate content correctly', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    expect(content).toEqual(pages[0].pageContent);
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load DOC file');
  });
});
