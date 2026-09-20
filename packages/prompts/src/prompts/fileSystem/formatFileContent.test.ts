import { describe, expect, it } from 'vitest';

import { formatFileContent } from './formatFileContent';

describe('formatFileContent', () => {
  it('should return content unchanged without line numbers', () => {
    const result = formatFileContent({
      content: 'console.log("hello");',
    });
    expect(result).toBe('console.log("hello");');
  });

  it('should handle empty content', () => {
    const result = formatFileContent({
      content: '',
      firstLineNumber: 1,
    });
    expect(result).toBe('');
  });

  it('should prefix each line with its 1-based line number', () => {
    const result = formatFileContent({
      content: 'function test() {\n  return true;\n}',
      firstLineNumber: 11,
      lineRange: [10, 13],
      totalLines: 13,
    });
    expect(result).toMatchInlineSnapshot(`
      "11 function test() {
      12   return true;
      13 }"
    `);
  });

  it('should pad line numbers to the width of the last line', () => {
    const result = formatFileContent({
      content: 'a\nb\nc',
      firstLineNumber: 9,
    });
    expect(result).toMatchInlineSnapshot(`
      " 9 a
      10 b
      11 c"
    `);
  });

  it('should mark a window that stops before the end of the file', () => {
    const result = formatFileContent({
      content: 'line 1\nline 2',
      firstLineNumber: 1,
      lineRange: [0, 1000],
      totalLines: 2545,
    });
    expect(result).toMatchInlineSnapshot(`
      "(lines 1-1000 of 2545)
      1 line 1
      2 line 2"
    `);
  });

  it('should not mark a window that reaches the end of the file', () => {
    const result = formatFileContent({
      content: 'last line',
      firstLineNumber: 2501,
      lineRange: [2500, 2545],
      totalLines: 2545,
    });
    expect(result).toBe('2501 last line');
  });

  it('should not mark a window clamped at the total line count', () => {
    const result = formatFileContent({
      content: 'a\nb',
      firstLineNumber: 1,
      lineRange: [0, 1000],
      totalLines: 2,
    });
    expect(result).not.toContain('(lines');
  });

  it('should not mark a service-truncated window even when it stops before EOF', () => {
    const result = formatFileContent({
      content: 'partial\n[content truncated: response was 600000 chars, kept first 500000.]',
      firstLineNumber: 1,
      lineRange: [0, 1000],
      totalLines: 2545,
      truncated: true,
    });
    expect(result).not.toContain('(lines');
  });

  it('should not mark a window without a total line count', () => {
    const result = formatFileContent({
      content: 'some lines',
      firstLineNumber: 1,
      lineRange: [0, 200],
    });
    expect(result).toBe('1 some lines');
  });
});
