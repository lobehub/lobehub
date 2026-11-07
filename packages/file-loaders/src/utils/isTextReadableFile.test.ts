import { describe, expect, it } from 'vitest';

import { isTextReadableFile } from './isTextReadableFile';

describe('isTextReadableFile', () => {
  it('should return true for common text-readable types', () => {
    const positives = [
      'txt',
      'md',
      'mdx',
      'json',
      'yaml',
      'yml',
      'csv',
      'html',
      'css',
      'js',
      'ts',
      'py',
      'log',
      'sql',
      'patch',
      'diff',
      'v',
      'sv',
    ];

    for (const ext of positives) {
      expect(isTextReadableFile(ext)).toBe(true);
    }
  });

  it('should be case-insensitive', () => {
    expect(isTextReadableFile('Md')).toBe(true);
    expect(isTextReadableFile('JSON')).toBe(true);
    expect(isTextReadableFile('YML')).toBe(true);
  });

  it('should return false for non text-readable or binary types', () => {
    const negatives = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'gif'];
    for (const ext of negatives) {
      expect(isTextReadableFile(ext)).toBe(false);
    }
  });
});
