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
