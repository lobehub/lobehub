import { describe, expect, it } from 'vitest';

import { markdownToTelegramHTML } from './markdownToHTML';

describe('markdownToTelegramHTML', () => {
  it('should convert bold', () => {
    expect(markdownToTelegramHTML('**bold text**')).toBe('<b>bold text</b>');
  });

  it('should convert italic', () => {
    expect(markdownToTelegramHTML('*italic text*')).toBe('<i>italic text</i>');
  });

  it('should convert bold + italic', () => {
    expect(markdownToTelegramHTML('***bold italic***')).toBe('<b><i>bold italic</i></b>');
  });

  it('should convert strikethrough', () => {
    expect(markdownToTelegramHTML('~~deleted~~')).toBe('<s>deleted</s>');
  });

  it('should convert inline code', () => {
    expect(markdownToTelegramHTML('run `npm install` now')).toBe(
      'run <code>npm install</code> now',
    );
  });

  it('should convert fenced code blocks', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(markdownToTelegramHTML(input)).toBe(
      '<pre><code class="language-typescript">const x = 1;</code></pre>',
    );
  });

  it('should convert fenced code blocks without language', () => {
    const input = '```\nplain code\n```';
    expect(markdownToTelegramHTML(input)).toBe('<pre>plain code</pre>');
  });

  it('should convert links', () => {
    expect(markdownToTelegramHTML('[Click](https://example.com)')).toBe(
      '<a href="https://example.com">Click</a>',
    );
  });

  it('should convert headings to bold', () => {
    expect(markdownToTelegramHTML('# Title')).toBe('<b>Title</b>');
    expect(markdownToTelegramHTML('## Subtitle')).toBe('<b>Subtitle</b>');
  });

  it('should convert blockquotes', () => {
    expect(markdownToTelegramHTML('> quoted text')).toBe('<blockquote>quoted text</blockquote>');
  });

  it('should merge consecutive blockquotes', () => {
    const input = '> line 1\n> line 2';
    expect(markdownToTelegramHTML(input)).toBe('<blockquote>line 1\nline 2</blockquote>');
  });

  it('should escape HTML entities in text', () => {
    expect(markdownToTelegramHTML('a < b > c & d')).toBe('a &lt; b &gt; c &amp; d');
  });

  it('should escape HTML entities inside code blocks', () => {
    const input = '```\n<div>hello</div>\n```';
    expect(markdownToTelegramHTML(input)).toBe('<pre>&lt;div&gt;hello&lt;/div&gt;</pre>');
  });

  it('should escape HTML entities in inline code', () => {
    expect(markdownToTelegramHTML('use `<b>tag</b>`')).toBe(
      'use <code>&lt;b&gt;tag&lt;/b&gt;</code>',
    );
  });

  it('should handle a complex document', () => {
    const input = [
      '# Hello',
      '',
      'This is **bold** and *italic*.',
      '',
      '```js',
      'const x = 1 < 2;',
      '```',
      '',
      '[Link](https://example.com)',
    ].join('\n');

    const result = markdownToTelegramHTML(input);
    expect(result).toContain('<b>Hello</b>');
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<i>italic</i>');
    expect(result).toContain('<pre><code class="language-js">const x = 1 &lt; 2;</code></pre>');
    expect(result).toContain('<a href="https://example.com">Link</a>');
  });

  it('should pass through plain text (with HTML escaping)', () => {
    expect(markdownToTelegramHTML('Hello world')).toBe('Hello world');
  });
});
