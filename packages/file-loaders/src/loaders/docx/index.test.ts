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
    // DOCX 通常加载为单个页面
    expect(pages).toHaveLength(1);
    expect(pages).toMatchSnapshot();
  });

  it('should aggregate content correctly', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // 对于单页文档，聚合内容应与页面内容相同
    expect(content).toEqual(pages[0].pageContent);
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // 即使失败也返回一个包含错误信息的页面
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load DOCX file');
  });
});
