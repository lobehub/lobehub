import { describe, expect, it } from 'vitest';

import { getResourceQueryKey } from './utils';

describe('getResourceQueryKey', () => {
  it('returns one stable default key when no query is given', () => {
    expect(getResourceQueryKey()).toBe('resource-query:default');
    expect(getResourceQueryKey(null)).toBe('resource-query:default');
  });

  it('keys by the fields that select the row set', () => {
    expect(getResourceQueryKey({ parentId: 'folder-a' })).toBe(
      getResourceQueryKey({ parentId: 'folder-a' }),
    );
    expect(getResourceQueryKey({ parentId: 'folder-a' })).not.toBe(
      getResourceQueryKey({ parentId: 'folder-b' }),
    );
    expect(getResourceQueryKey({ q: 'foo' })).not.toBe(getResourceQueryKey({ q: 'bar' }));
    expect(getResourceQueryKey({ libraryId: 'kb-1' })).not.toBe(
      getResourceQueryKey({ libraryId: 'kb-2' }),
    );
  });
});
