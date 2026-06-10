import { describe, expect, it } from 'vitest';

import { parseLocalFileHref } from './parse';

describe('parseLocalFileHref', () => {
  it('parses a macOS absolute path with a line suffix', () => {
    expect(
      parseLocalFileHref('/Users/arvinxx/project/src/Group.tsx:265', {
        workingDirectory: '/Users/arvinxx/project',
      }),
    ).toEqual({
      filePath: '/Users/arvinxx/project/src/Group.tsx',
      line: 265,
      workingDirectory: '/Users/arvinxx/project',
    });
  });

  it('parses file URLs and strips line and column suffixes', () => {
    expect(parseLocalFileHref('file:///Users/me/My%20File.tsx:10:2')).toEqual({
      column: 2,
      filePath: '/Users/me/My File.tsx',
      line: 10,
      workingDirectory: '/Users/me',
    });
  });

  it('uses the file directory as working directory when no active cwd matches', () => {
    expect(parseLocalFileHref('/tmp/report.md')).toEqual({
      filePath: '/tmp/report.md',
      workingDirectory: '/tmp',
    });
  });

  it('ignores normal app routes and external URLs', () => {
    expect(parseLocalFileHref('/settings/profile')).toBeNull();
    expect(parseLocalFileHref('https://example.com/file.ts')).toBeNull();
    expect(parseLocalFileHref('#user-content-fn-1')).toBeNull();
  });
});
