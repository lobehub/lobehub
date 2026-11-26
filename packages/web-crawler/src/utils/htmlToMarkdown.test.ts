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

  it('should not crash on HTML with invalid CSS selectors ()', () => {
    // Regression: happy-dom throws TypeError on pages with CSS selectors it cannot parse.
    // htmlToMarkdown must not propagate this — it should fall back to raw HTML conversion.
    const html = `
      <html><head>
        <style>:is(.foo, :has(> .bar)) { color: red }</style>
      </head><body>
        <script type="application/ld+json">{"@type":"Article","name":"Test"}</script>
        <p>Valid content here</p>
      </body></html>`;

    const result = htmlToMarkdown(html, { url: 'https://example.com', filterOptions: {} });

    expect(result).toBeDefined();
    expect(result.content).toContain('Valid content');
  });

  it('should not crash on HTML with external stylesheet links ()', () => {
    // Regression: happy-dom's HTMLLinkElement.#loadStyleSheet can crash on CSS parsing.
    // disableCSSFileLoading should prevent this path entirely.
    const html = `
      <html><head>
        <link rel="stylesheet" href="https://example.com/styles.css">
      </head><body>
        <p>Content with external CSS</p>
      </body></html>`;

    const result = htmlToMarkdown(html, { url: 'https://example.com', filterOptions: {} });

    expect(result).toBeDefined();
    expect(result.content).toContain('Content with external CSS');
  });

  it('should not truncate HTML under 1 MB', () => {
    const html = '<html><body><p>Small content</p></body></html>';

    const result = htmlToMarkdown(html, { url: 'https://example.com', filterOptions: {} });

    expect(result).toBeDefined();
    expect(result.content).toContain('Small content');
  });
  describe('table cells', () => {
    const convert = (body: string) =>
      htmlToMarkdown(`<html><body><article>${body}</article></body></html>`, {
        filterOptions: { enableReadability: false },
        url: 'https://example.com',
      }).content;

    /** Read the markdown table back the way a reader does. */
    const rows = (markdown: string) =>
      markdown
        .split('\n')
        .filter((line) => line.trim().startsWith('|'))
        .map((line) =>
          line
            .trim()
            .replaceAll(/^\||\|$/g, '')
            .split(/(?<!\\)\|/)
            .map((cell) => cell.replaceAll(/\\(.)/g, '$1').trim()),
        );

    it('keeps the word boundary a line break inside a cell stands for', () => {
      // The cell's child translators hold no block element, so the break used
      // to vanish without a trace and the two values ran into one word.
      const markdown = convert(
        '<table><tr><th>Day</th><th>Hours</th></tr><tr><td>Mon</td><td>09:00<br>17:00</td></tr></table>',
      );

      expect(rows(markdown)[2]).toEqual(['Mon', '09:00 17:00']);
    });

    it.each([
      ['<p>first</p><p>second</p>', 'first second'],
      ['<div>first</div><div>second</div>', 'first second'],
      ['<ul><li>first</li><li>second</li></ul>', 'first second'],
    ])('keeps the boundary between two blocks in a cell (%s)', (cell, expected) => {
      const markdown = convert(`<table><tr><th>Note</th></tr><tr><td>${cell}</td></tr></table>`);

      expect(rows(markdown)[2]).toEqual([expected]);
    });

    it('escapes every pipe in a cell, not only the first', () => {
      // node-html-markdown escapes with a string argument, so the second pipe
      // survived and split the row into columns the header does not have.
      const markdown = convert(
        '<table><tr><th>Name</th><th>Modes</th></tr><tr><td>codec</td><td>a|b|c</td></tr></table>',
      );

      expect(rows(markdown)[2]).toEqual(['codec', 'a|b|c']);
    });

    it('leaves a cell that needs neither alone', () => {
      const markdown = convert(
        '<table><tr><th>Name</th></tr><tr><td><strong>bold</strong> and <a href="https://example.com/d">docs</a></td></tr></table>',
      );

      expect(rows(markdown)[2]).toEqual(['**bold** and [docs](https://example.com/d)']);
    });

    it('leaves a line break outside a table alone', () => {
      expect(convert('<p>first<br>second</p>')).toContain('first  \nsecond');
    });
  });
});
