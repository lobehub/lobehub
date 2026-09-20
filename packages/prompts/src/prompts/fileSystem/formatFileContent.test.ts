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
