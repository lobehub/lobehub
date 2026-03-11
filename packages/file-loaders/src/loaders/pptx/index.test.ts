// @vitest-environment node
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { PptxLoader } from './index';

// Import PptxLoader

// 确保你已经在 fixtures 目录下放置了 test.pptx 文件
// 这个 PPTX 文件最好包含多个幻灯片 (slides) 以便测试
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
    // PPTX 文件有多少个 slide，就应该有多少个 page
    expect(pages.length).toBeGreaterThan(1);

    // 直接对整个 pages 数组进行快照测试 (会包含 slideNumber)
    expect(pages).toMatchSnapshot();
  });

  it('should aggregate content correctly (joining slides)', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // 默认聚合是以换行符连接各 slide 内容
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // 即使失败也返回一个包含错误信息的页面
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
    expect(content).toBe(''); // 所有页面都是错误页面时返回空字符串
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
