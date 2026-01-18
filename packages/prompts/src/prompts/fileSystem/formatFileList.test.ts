import { describe, expect, it } from 'vitest';

import { formatFileList } from './formatFileList';

describe('formatFileList', () => {
  it('should format empty directory', () => {
    const result = formatFileList([], '/home/user');
    expect(result).toMatchInlineSnapshot(`"Directory /home/user is empty"`);
  });

  it('should format directory with files only', () => {
    const files = [
      { isDirectory: false, name: 'file1.txt' },
      { isDirectory: false, name: 'file2.js' },
    ];
    const result = formatFileList(files, '/home/user');
    expect(result).toMatchInlineSnapshot(`
      "Found 2 item(s) in /home/user:
        [F] file1.txt
        [F] file2.js"
    `);
  });

  it('should format directory with directories only', () => {
    const files = [
      { isDirectory: true, name: 'src' },
      { isDirectory: true, name: 'dist' },
    ];
    const result = formatFileList(files, '/project');
    expect(result).toMatchInlineSnapshot(`
      "Found 2 item(s) in /project:
        [D] src
        [D] dist"
    `);
  });

  it('should format directory with mixed content', () => {
    const files = [
      { isDirectory: true, name: 'src' },
      { isDirectory: false, name: 'package.json' },
      { isDirectory: true, name: 'node_modules' },
      { isDirectory: false, name: 'README.md' },
    ];
    const result = formatFileList(files, '/project');
    expect(result).toMatchInlineSnapshot(`
      "Found 4 item(s) in /project:
        [D] src
        [F] package.json
        [D] node_modules
        [F] README.md"
    `);
  });

  it('should format single item', () => {
    const files = [{ isDirectory: false, name: 'index.ts' }];
    const result = formatFileList(files, '/src');
    expect(result).toMatchInlineSnapshot(`
      "Found 1 item(s) in /src:
        [F] index.ts"
    `);
  });
});
