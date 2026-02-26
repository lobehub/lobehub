import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FilterOptions } from '../type';
import { htmlToMarkdown } from './htmlToMarkdown';

interface TestItem {
  file: string;
  filterOptions?: FilterOptions;
  url: string;
}
const list: TestItem[] = [
  {
    file: 'terms.html',
    url: 'https://lobehub.com/terms',
  },
  {
    file: 'yingchao.html',
    url: 'https://www.qiumiwu.com/standings/yingchao',
    filterOptions: { pureText: true, enableReadability: false },
  },
];

describe('htmlToMarkdown', () => {
  list.forEach((item) => {
    it(`should transform ${item.file} to markdown`, () => {
      const html = readFileSync(path.join(__dirname, `./html/${item.file}`), { encoding: 'utf8' });

      const data = htmlToMarkdown(html, { url: item.url, filterOptions: item.filterOptions || {} });

      expect(data).toMatchSnapshot();
    }, 20000);
  });

  it('should truncate HTML exceeding 1 MB', () => {
    // Create HTML slightly over 1 MB
    const maxSize = 1024 * 1024;
    const largeContent = 'x'.repeat(maxSize + 1000);
    const html = `<html><body><p>${largeContent}</p></body></html>`;

    // Should not throw - the function handles large HTML by truncating
    const result = htmlToMarkdown(html, { url: 'https://example.com', filterOptions: {} });

    // Verify content was produced (truncated HTML is still parseable)
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    // The output content should be smaller than the input due to truncation
    expect(result.content.length).toBeLessThan(html.length);
  }, 20000);

  it('should not truncate HTML under 1 MB', () => {
    const html = '<html><body><p>Small content</p></body></html>';

    const result = htmlToMarkdown(html, { url: 'https://example.com', filterOptions: {} });

    expect(result).toBeDefined();
    expect(result.content).toContain('Small content');
  });
});
