import { describe, expect, it } from 'vitest';

import { markdownToSlackMrkdwn } from './markdownToMrkdwn';

describe('markdownToSlackMrkdwn', () => {
  it('should convert bold', () => {
    expect(markdownToSlackMrkdwn('**bold text**')).toBe('*bold text*');
  });

  it('should convert bold+italic', () => {
    expect(markdownToSlackMrkdwn('***bold italic***')).toBe('*_bold italic_*');
  });

  it('should convert strikethrough', () => {
    expect(markdownToSlackMrkdwn('~~deleted~~')).toBe('~deleted~');
  });

  it('should preserve inline code', () => {
    expect(markdownToSlackMrkdwn('run `npm install` now')).toBe('run `npm install` now');
  });

  it('should convert fenced code blocks (strip language)', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(markdownToSlackMrkdwn(input)).toBe('```const x = 1;```');
  });

  it('should convert links', () => {
    expect(markdownToSlackMrkdwn('[Click](https://example.com)')).toBe(
      '<https://example.com|Click>',
    );
  });

  it('should convert images to links', () => {
    expect(markdownToSlackMrkdwn('![logo](https://img.png)')).toBe('<https://img.png|logo>');
  });

  it('should convert headings to bold', () => {
    expect(markdownToSlackMrkdwn('# Title')).toBe('*Title*');
    expect(markdownToSlackMrkdwn('## Subtitle')).toBe('*Subtitle*');
  });

  it('should preserve blockquotes', () => {
    expect(markdownToSlackMrkdwn('> quoted text')).toBe('> quoted text');
  });

  it('should not convert markdown inside code blocks', () => {
    const input = '```\n**not bold** and *not italic*\n```';
    expect(markdownToSlackMrkdwn(input)).toBe('```**not bold** and *not italic*```');
  });

  it('should not convert markdown inside inline code', () => {
    expect(markdownToSlackMrkdwn('use `**bold**` syntax')).toBe('use `**bold**` syntax');
  });

  it('should handle a complex document', () => {
    const input = [
      '# Hello',
      '',
      'This is **bold** and ~~deleted~~.',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '[Link](https://example.com)',
    ].join('\n');

    const result = markdownToSlackMrkdwn(input);
    expect(result).toContain('*Hello*');
    expect(result).toContain('*bold*');
    expect(result).toContain('~deleted~');
    expect(result).toContain('```const x = 1;```');
    expect(result).toContain('<https://example.com|Link>');
  });

  it('should pass through plain text unchanged', () => {
    expect(markdownToSlackMrkdwn('Hello world')).toBe('Hello world');
  });
});
