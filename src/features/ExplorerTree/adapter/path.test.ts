import { describe, expect, it } from 'vitest';

import { toCanonicalTreePath } from './path';

describe('toCanonicalTreePath', () => {
  it('restores the canonical folder path used by the tree adapter', () => {
    expect(toCanonicalTreePath('Notes', true)).toBe('Notes/');
    expect(toCanonicalTreePath('Notes/', true)).toBe('Notes/');
  });

  it('keeps file paths unchanged', () => {
    expect(toCanonicalTreePath('Notes/readme.md', false)).toBe('Notes/readme.md');
  });
});
