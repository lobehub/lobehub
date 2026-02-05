// @vitest-environment node
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { PdfLoader } from './index';

// 确保你已经在 fixtures 目录下放置了 test.pdf 文件
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
    // 默认聚合是以换行符连接各页内容
    expect(content).toMatchSnapshot();
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // 即使失败也返回一个包含错误信息的页面
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load or parse PDF file:');
  });

  it('should attach document metadata correctly', async () => {
    // 首先加载页面以初始化 pdfInstance，尽管此方法不直接使用页面
    await loader.loadPages(testFile);
    const metadata = await loader.attachDocumentMetadata!(testFile);

    expect(metadata).toMatchSnapshot();
  });
});
