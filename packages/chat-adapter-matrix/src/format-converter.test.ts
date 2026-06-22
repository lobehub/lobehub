import { describe, expect, it } from 'vitest';

import { htmlToPlainText, markdownToMatrixHtml } from './format-converter';

describe('markdownToMatrixHtml', () => {
  it('renders emphasis, strong and inline code', () => {
    expect(markdownToMatrixHtml('a **b** _c_ `d`')).toBe(
      '<p>a <strong>b</strong> <em>c</em> <code>d</code></p>',
    );
  });

  it('renders fenced code blocks with a language class', () => {
    expect(markdownToMatrixHtml('```ts\nconst a = 1;\n```')).toBe(
      '<pre><code class="language-ts">const a = 1;</code></pre>',
    );
  });

  it('renders links and escapes the href', () => {
    expect(markdownToMatrixHtml('[x](https://e.org?a=1&b=2)')).toBe(
      '<p><a href="https://e.org?a=1&amp;b=2">x</a></p>',
    );
  });

  it('renders bullet and ordered lists', () => {
    expect(markdownToMatrixHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToMatrixHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('escapes raw html in text', () => {
    expect(markdownToMatrixHtml('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
  });

  it('returns empty string for empty input', () => {
    expect(markdownToMatrixHtml('')).toBe('');
  });
});

describe('htmlToPlainText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToPlainText('<p>hello <strong>world</strong></p>')).toBe('hello world');
    expect(htmlToPlainText('a<br/>b')).toBe('a\nb');
    expect(htmlToPlainText('x &amp; y &lt;z&gt;')).toBe('x & y <z>');
  });
});
