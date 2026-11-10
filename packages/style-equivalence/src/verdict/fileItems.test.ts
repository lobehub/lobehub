import { describe, expect, it } from 'vitest';

import { fileFlags, fileItemKey, STYLE_OUTSIDE_JSX } from './fileItems';

const side = (outsideReferences: string[] = []) => ({ outsideReferences });

describe('fileFlags', () => {
  it('carries file gaps and style references outside JSX into a file-level item', () => {
    expect(
      fileFlags(
        { gaps: ['STYLESHEET_UNREADABLE:./a.css'] },
        { base: side(['styles@4']), head: side() },
      ),
    ).toEqual(['STYLESHEET_UNREADABLE:./a.css', STYLE_OUTSIDE_JSX]);
  });

  it('has nothing to sign when every style use is inside JSX', () => {
    expect(fileFlags({ gaps: [] }, { base: side(), head: side() })).toEqual([]);
  });

  it('keys the item by file', () => {
    expect(fileItemKey('src/A.tsx')).toBe('src/A.tsx|file');
  });
});
