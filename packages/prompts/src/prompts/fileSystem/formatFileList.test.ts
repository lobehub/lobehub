import { describe, expect, it } from 'vitest';

import { formatFileList } from './formatFileList';

describe('formatFileList', () => {
  describe('snapshot tests', () => {
    it('should match snapshot for complete extended output', () => {
      const files = [
        {
          isDirectory: true,
          modifiedTime: new Date('2024-01-20T14:30:00'),
          name: 'Documents',
          size: 4096,
        },
        {
          isDirectory: true,
          modifiedTime: new Date('2024-01-18T09:15:00'),
          name: 'Downloads',
          size: 4096,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-15T11:20:00'),
          name: 'report.pdf',
          size: 2457600,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-10T16:45:00'),
          name: 'screenshot.png',
          size: 1153434,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-05T08:30:00'),
          name: 'notes.txt',
          size: 2048,
        },
      ];

      const result = formatFileList({
        directory: '/Users/test/Desktop',
        files,
        sortBy: 'modifiedTime',
        sortOrder: 'desc',
        totalCount: 150,
      });

      expect(result).toMatchInlineSnapshot(`
        "Found 150 item(s) in /Users/test/Desktop (showing first 5, sorted by modifiedTime desc):
          [D] Documents                                2024-01-20 14:30      --
          [D] Downloads                                2024-01-18 09:15      --
          [F] report.pdf                               2024-01-15 11:20      2.3 MB
          [F] screenshot.png                           2024-01-10 16:45      1.1 MB
          [F] notes.txt                                2024-01-05 08:30        2 KB"
      `);
    });

    it('should match snapshot for simple output without extended info', () => {
      const files = [
        { isDirectory: true, name: 'src' },
        { isDirectory: true, name: 'dist' },
        { isDirectory: false, name: 'package.json' },
        { isDirectory: false, name: 'README.md' },
        { isDirectory: false, name: 'tsconfig.json' },
      ];

      const result = formatFileList({ directory: '/project', files });

      expect(result).toMatchInlineSnapshot(`
        "Found 5 item(s) in /project:
          [D] src
          [D] dist
          [F] package.json
          [F] README.md
          [F] tsconfig.json"
      `);
    });

    it('should match snapshot for output with sorting info only', () => {
      const files = [
        { isDirectory: false, name: 'alpha.txt' },
        { isDirectory: false, name: 'beta.txt' },
        { isDirectory: false, name: 'gamma.txt' },
      ];

      const result = formatFileList({
        directory: '/test',
        files,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result).toMatchInlineSnapshot(`
        "Found 3 item(s) in /test (sorted by name asc):
          [F] alpha.txt
          [F] beta.txt
          [F] gamma.txt"
      `);
    });

    it('should match snapshot for various file sizes', () => {
      const files = [
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01T00:00:00'),
          name: 'empty.txt',
          size: 0,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01T00:00:00'),
          name: 'tiny.txt',
          size: 512,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01T00:00:00'),
          name: 'small.txt',
          size: 1024,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01T00:00:00'),
          name: 'medium.txt',
          size: 1048576,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01T00:00:00'),
          name: 'large.txt',
          size: 1073741824,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01T00:00:00'),
          name: 'huge.txt',
          size: 1099511627776,
        },
      ];

      const result = formatFileList({ directory: '/test', files });

      expect(result).toMatchInlineSnapshot(`
        "Found 6 item(s) in /test:
          [F] empty.txt                                2024-01-01 00:00         0 B
          [F] tiny.txt                                 2024-01-01 00:00       512 B
          [F] small.txt                                2024-01-01 00:00        1 KB
          [F] medium.txt                               2024-01-01 00:00        1 MB
          [F] large.txt                                2024-01-01 00:00        1 GB
          [F] huge.txt                                 2024-01-01 00:00        1 TB"
      `);
    });
  });

  it('should format empty directory', () => {
    const result = formatFileList({ directory: '/home/user', files: [] });
    expect(result).toMatchInlineSnapshot(`"Directory /home/user is empty"`);
  });

  it('should format directory with files only', () => {
    const files = [
      { isDirectory: false, name: 'file1.txt' },
      { isDirectory: false, name: 'file2.js' },
    ];
    const result = formatFileList({ directory: '/home/user', files });
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
    const result = formatFileList({ directory: '/project', files });
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
    const result = formatFileList({ directory: '/project', files });
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
    const result = formatFileList({ directory: '/src', files });
    expect(result).toMatchInlineSnapshot(`
      "Found 1 item(s) in /src:
        [F] index.ts"
    `);
  });

  describe('extended info', () => {
    it('should format files with size and modified time', () => {
      const files = [
        {
          isDirectory: true,
          modifiedTime: new Date('2024-01-20T14:30:00'),
          name: 'src',
          size: 4096,
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-18T09:15:00'),
          name: 'report.pdf',
          size: 2457600, // 2.4 MB
        },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-15T11:20:00'),
          name: 'screenshot.png',
          size: 1153434, // ~1.1 MB
        },
      ];
      const result = formatFileList({ directory: '/Users/test/Downloads', files });
      expect(result).toContain('Found 3 item(s) in /Users/test/Downloads');
      expect(result).toContain('[D] src');
      expect(result).toContain('[F] report.pdf');
      expect(result).toContain('2024-01-20 14:30');
      expect(result).toContain('2.3 MB');
    });

    it('should show sorting and limit info in header', () => {
      const files = [
        { isDirectory: false, name: 'file1.txt' },
        { isDirectory: false, name: 'file2.txt' },
      ];
      const result = formatFileList({
        directory: '/test',
        files,
        sortBy: 'modifiedTime',
        sortOrder: 'desc',
        totalCount: 150,
      });
      expect(result).toContain('Found 150 item(s)');
      expect(result).toContain('showing first 2');
      expect(result).toContain('sorted by modifiedTime desc');
    });

    it('should not show limit info when not truncated', () => {
      const files = [
        { isDirectory: false, name: 'file1.txt' },
        { isDirectory: false, name: 'file2.txt' },
      ];
      const result = formatFileList({
        directory: '/test',
        files,
        sortBy: 'name',
        sortOrder: 'asc',
      });
      expect(result).not.toContain('showing');
      expect(result).toContain('sorted by name asc');
    });

    it('should show -- for directory size', () => {
      const files = [
        {
          isDirectory: true,
          modifiedTime: new Date('2024-01-20T14:30:00'),
          name: 'my_folder',
          size: 4096,
        },
      ];
      const result = formatFileList({ directory: '/test', files });
      expect(result).toContain('--');
    });

    it('should format various file sizes correctly', () => {
      const files = [
        { isDirectory: false, modifiedTime: new Date('2024-01-01'), name: 'zero.txt', size: 0 },
        { isDirectory: false, modifiedTime: new Date('2024-01-01'), name: 'bytes.txt', size: 500 },
        { isDirectory: false, modifiedTime: new Date('2024-01-01'), name: 'kb.txt', size: 2048 },
        { isDirectory: false, modifiedTime: new Date('2024-01-01'), name: 'mb.txt', size: 5242880 },
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01'),
          name: 'gb.txt',
          size: 1073741824,
        },
      ];
      const result = formatFileList({ directory: '/test', files });
      expect(result).toContain('0 B');
      expect(result).toContain('500 B');
      expect(result).toContain('2 KB');
      expect(result).toContain('5 MB');
      expect(result).toContain('1 GB');
    });

    it('should handle files with only size (no modifiedTime)', () => {
      const files = [{ isDirectory: false, name: 'file.txt', size: 1024 }];
      const result = formatFileList({ directory: '/test', files });
      expect(result).toContain('[F] file.txt');
      expect(result).toContain('1 KB');
    });

    it('should handle files with only modifiedTime (no size)', () => {
      const files = [
        { isDirectory: false, modifiedTime: new Date('2024-06-15T10:30:00'), name: 'file.txt' },
      ];
      const result = formatFileList({ directory: '/test', files });
      expect(result).toContain('[F] file.txt');
      expect(result).toContain('2024-06-15 10:30');
    });

    it('should handle long file names', () => {
      const files = [
        {
          isDirectory: false,
          modifiedTime: new Date('2024-01-01'),
          name: 'this_is_a_very_long_filename_that_exceeds_normal_length.txt',
          size: 1024,
        },
      ];
      const result = formatFileList({ directory: '/test', files });
      expect(result).toContain('this_is_a_very_long_filename_that_exceeds_normal_length.txt');
    });

    it('should handle options with only totalCount', () => {
      const files = [{ isDirectory: false, name: 'file.txt' }];
      const result = formatFileList({ directory: '/test', files, totalCount: 100 });
      expect(result).toContain('Found 100 item(s)');
      expect(result).toContain('showing first 1');
    });

    it('should not show extra info when totalCount equals file count', () => {
      const files = [
        { isDirectory: false, name: 'file1.txt' },
        { isDirectory: false, name: 'file2.txt' },
      ];
      const result = formatFileList({ directory: '/test', files, totalCount: 2 });
      expect(result).not.toContain('showing');
    });
  });
});
