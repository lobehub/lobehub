import { describe, expect, it } from 'vitest';

import { assertPackageRelativePath } from './pathSafety';

describe('assertPackageRelativePath', () => {
  it('accepts package-relative paths', () => {
    expect(assertPackageRelativePath('SKILL.md')).toBe('SKILL.md');
    expect(assertPackageRelativePath('references/checklist.md')).toBe('references/checklist.md');
  });

  it('rejects unsafe paths', () => {
    expect(() => assertPackageRelativePath('/etc/passwd')).toThrow(
      'absolute paths are not allowed',
    );
    expect(() => assertPackageRelativePath('../SKILL.md')).toThrow('path traversal is not allowed');
    expect(() => assertPackageRelativePath('references/../../SKILL.md')).toThrow(
      'path traversal is not allowed',
    );
  });
});
