import { describe, expect, it } from 'vitest';

import { formatFileContent } from './formatFileContent';

describe('formatFileContent', () => {
  it('should format file content without line range', () => {
    const result = formatFileContent({
      content: 'console.log("hello");',
      path: '/src/index.ts',
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /src/index.ts

      console.log("hello");"
    `);
  });

  it('should format file content with line range', () => {
    const result = formatFileContent({
      content: 'function test() {\n  return true;\n}',
      lineRange: [10, 12],
      path: '/src/utils.ts',
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /src/utils.ts (lines 10-12)

      function test() {
        return true;
      }"
    `);
  });

  it('should show the total line count alongside the returned window', () => {
    const result = formatFileContent({
      content: 'line 1\nline 2',
      lineRange: [0, 200],
      path: '/src/big.ts',
      totalLines: 2545,
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /src/big.ts (lines 0-200 of 2545)

      line 1
      line 2
      [Showing lines 0-200 of 2545 total. Call readFile again with loc=[200, 400] to continue reading.]"
    `);
  });

  it('should not append a continuation hint when the window reaches the end of the file', () => {
    const result = formatFileContent({
      content: 'last line',
      lineRange: [2500, 2545],
      path: '/src/big.ts',
      totalLines: 2545,
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /src/big.ts (lines 2500-2545 of 2545)

      last line"
    `);
  });

  it('should clamp the suggested continuation window at the total line count', () => {
    const result = formatFileContent({
      content: 'some lines',
      lineRange: [2400, 2500],
      path: '/src/big.ts',
      totalLines: 2545,
    });
    expect(result).toContain('loc=[2500, 2545]');
  });

  it('should continue with a window the same size as the returned one', () => {
    const result = formatFileContent({
      content: 'some lines',
      lineRange: [0, 1000],
      path: '/src/big.ts',
      totalLines: 2545,
    });
    expect(result).toContain('loc=[1000, 2000]');
  });

  it('should clamp the displayed window at the total line count', () => {
    const result = formatFileContent({
      content: 'line 1\nline 2',
      lineRange: [0, 1000],
      path: '/src/small.ts',
      totalLines: 2,
    });
    expect(result).toContain('(lines 0-2 of 2)');
    expect(result).not.toContain('to continue reading');
  });

  it('should not append a continuation hint when the service truncated the content', () => {
    const result = formatFileContent({
      content:
        'partial content\n[content truncated: response was 600000 chars, kept first 500000.]',
      lineRange: [0, 1000],
      path: '/src/big.ts',
      totalLines: 2545,
      truncated: true,
    });
    expect(result).toContain('(lines 0-1000 of 2545)');
    expect(result).not.toContain('to continue reading');
  });

  it('should use the backend-specific continuation arguments when provided', () => {
    const result = formatFileContent({
      content: 'some lines',
      formatContinuation: ([start, end]) => `startLine=${start + 1}, endLine=${end}`,
      lineRange: [0, 200],
      path: '/src/big.ts',
      totalLines: 2545,
    });
    expect(result).toContain('startLine=201, endLine=400');
    expect(result).not.toContain('loc=');
  });

  it('should prefix each line with its 1-based line number', () => {
    const result = formatFileContent({
      content: 'function test() {\n  return true;\n}',
      firstLineNumber: 11,
      lineRange: [10, 13],
      path: '/src/utils.ts',
      totalLines: 100,
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /src/utils.ts (lines 10-13 of 100)

      11→function test() {
      12→  return true;
      13→}
      [Showing lines 10-13 of 100 total. Call readFile again with loc=[13, 16] to continue reading.]"
    `);
  });

  it('should pad line numbers to the width of the last line', () => {
    const result = formatFileContent({
      content: 'a\nb\nc',
      firstLineNumber: 9,
      path: '/src/pad.ts',
    });
    expect(result).toContain(' 9→a');
    expect(result).toContain('10→b');
    expect(result).toContain('11→c');
  });

  it('should handle empty content', () => {
    const result = formatFileContent({
      content: '',
      path: '/empty.txt',
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /empty.txt

      "
    `);
  });

  it('should handle multiline content', () => {
    const content = 'line 1\nline 2\nline 3';
    const result = formatFileContent({
      content,
      path: '/test.txt',
    });
    expect(result).toMatchInlineSnapshot(`
      "File: /test.txt

      line 1
      line 2
      line 3"
    `);
  });
});
