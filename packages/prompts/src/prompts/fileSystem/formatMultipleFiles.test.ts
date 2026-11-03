import { describe, expect, it } from 'vitest';

import { formatMultipleFiles } from './formatMultipleFiles';

describe('formatMultipleFiles', () => {
  it('should format single file', () => {
    const files = [{ content: 'hello world', filename: 'test.txt' }];
    const result = formatMultipleFiles(files);
    expect(result).toMatchInlineSnapshot(`
      "Read 1 file(s):

      === test.txt ===
      hello world"
    `);
  });

  it('should format multiple files', () => {
    const files = [
      { content: 'content 1', filename: 'file1.txt' },
      { content: 'content 2', filename: 'file2.txt' },
    ];
    const result = formatMultipleFiles(files);
    expect(result).toMatchInlineSnapshot(`
      "Read 2 file(s):

      === file1.txt ===
      content 1

      === file2.txt ===
      content 2"
    `);
  });

  it('should handle empty files array', () => {
    const result = formatMultipleFiles([]);
    expect(result).toMatchInlineSnapshot(`
      "Read 0 file(s):

      "
    `);
  });

  it('should handle files with multiline content', () => {
    const files = [{ content: 'line 1\nline 2', filename: 'multi.txt' }];
    const result = formatMultipleFiles(files);
    expect(result).toMatchInlineSnapshot(`
      "Read 1 file(s):

      === multi.txt ===
      line 1
      line 2"
    `);
  });
});
