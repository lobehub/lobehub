import { describe, expect, it } from 'vitest';

import { stripMarkdown } from './stripMarkdown';

describe('stripMarkdown', () => {
  it('should remove heading markers', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
    expect(stripMarkdown('## Subtitle')).toBe('Subtitle');
    expect(stripMarkdown('### H3')).toBe('H3');
  });

  it('should remove bold formatting', () => {
    expect(stripMarkdown('**bold text**')).toBe('bold text');
    expect(stripMarkdown('__bold text__')).toBe('bold text');
  });

  it('should remove italic formatting', () => {
    expect(stripMarkdown('*italic text*')).toBe('italic text');
    expect(stripMarkdown('some _italic_ here')).toBe('some italic here');
  });

  it('should remove bold+italic formatting', () => {
    expect(stripMarkdown('***bold italic***')).toBe('bold italic');
  });

  it('should remove strikethrough', () => {
    expect(stripMarkdown('~~deleted~~')).toBe('deleted');
  });

  it('should remove inline code backticks', () => {
    expect(stripMarkdown('run `npm install` now')).toBe('run npm install now');
  });

  it('should remove fenced code block markers but keep content', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(stripMarkdown(input)).toBe('const x = 1;\n');
  });

  it('should convert links to text (url) format', () => {
    expect(stripMarkdown('[Click here](https://example.com)')).toBe(
      'Click here (https://example.com)',
    );
  });

  it('should convert images to alt text', () => {
    expect(stripMarkdown('![alt text](https://img.png)')).toBe('alt text');
  });

  it('should convert blockquotes to vertical bar', () => {
    expect(stripMarkdown('> quoted text')).toBe('| quoted text');
  });

  it('should handle tables by converting to bullet list', () => {
    const input = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
    const result = stripMarkdown(input);
    expect(result).toContain('- Name: Alice, Age: 30');
    expect(result).toContain('- Name: Bob, Age: 25');
  });

  it('should handle a complex mixed markdown document', () => {
    const input = [
      '# Hello World',
      '',
      'This is **bold** and *italic* text.',
      '',
      '- item 1',
      '- item 2',
      '',
      '```js',
      'console.log("hi");',
      '```',
      '',
      '[Link](https://example.com)',
    ].join('\n');

    const result = stripMarkdown(input);
    expect(result).not.toContain('**');
    expect(result).not.toContain('```');
    expect(result).not.toContain('# ');
    expect(result).toContain('Hello World');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('console.log("hi");');
    expect(result).toContain('Link (https://example.com)');
  });

  it('should pass through plain text unchanged', () => {
    expect(stripMarkdown('Hello world')).toBe('Hello world');
  });
});
