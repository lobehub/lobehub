import { readFileSync } from 'node:fs';
import * as path from 'node:path';

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
});
