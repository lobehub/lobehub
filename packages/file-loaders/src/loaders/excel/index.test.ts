import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { ExcelLoader } from './index';

// 确保你已经在 fixtures 目录下放置了 test.xlsx 文件
// 这个 Excel 文件最好包含多个工作表 (sheets) 以便测试
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
    // Excel 文件有多少个 sheet，就应该有多少个 page
    expect(pages.length).toBeGreaterThan(0);

    // 直接对整个 pages 数组进行快照测试
    expect(pages).toMatchSnapshot();

    // 如果你的 test.xlsx 有多个 sheet，可以添加更多断言
    // 例如检查特定 sheet 的 metadata 中的 sheetName
    // expect(pages[1].metadata.sheetName).toBe('Sheet2');
  });

  it('should aggregate content correctly (joining sheets)', async () => {
    const pages = await loader.loadPages(testFile);
    const content = await loader.aggregateContent(pages);
    // 默认聚合是以换行符连接各 sheet 内容
    expect(content).toMatchSnapshot('aggregated_content');
  });

  it('should handle file read errors in loadPages', async () => {
    const pages = await loader.loadPages(nonExistentFile);
    expect(pages).toHaveLength(1); // 即使失败也返回一个包含错误信息的页面
    expect(pages[0].pageContent).toBe('');
    expect(pages[0].metadata.error).toContain('Failed to load Excel file');
  });

  it('should handle Excel file with only headers', async () => {
    const onlyHeaderFile = fixturePath('only-header.xlsx');
    const pages = await loader.loadPages(onlyHeaderFile);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].pageContent).toBeTruthy(); // 应该包含表头内容
    expect(pages).toMatchSnapshot('only_header_pages');
  });
});
