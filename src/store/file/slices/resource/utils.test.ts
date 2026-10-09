import { describe, expect, it } from 'vitest';

import { getResourcePoolKey, getResourceQueryKey } from './utils';

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

describe('getResourcePoolKey', () => {
  it('is stable for the same pool and different across the pool-selecting fields', () => {
    expect(getResourcePoolKey({ parentId: null })).toBe(getResourcePoolKey({ parentId: null }));
    expect(getResourcePoolKey({ parentId: null })).not.toBe(
      getResourcePoolKey({ parentId: 'folder-a' }),
    );
    expect(getResourcePoolKey({ libraryId: 'kb-1' })).not.toBe(
      getResourcePoolKey({ libraryId: 'kb-2' }),
    );
    expect(getResourcePoolKey({ sourceFilter: 'all' })).not.toBe(
      getResourcePoolKey({ sourceFilter: 'uploaded' }),
    );
  });

  it('ignores the fields that only re-ask or re-arrange the same pool', () => {
    expect(getResourcePoolKey({ parentId: 'folder-a', q: 'foo' })).toBe(
      getResourcePoolKey({ parentId: 'folder-a' }),
    );
    expect(getResourcePoolKey({ parentId: 'folder-a', sorter: 'size', sortType: 'asc' })).toBe(
      getResourcePoolKey({ parentId: 'folder-a' }),
    );
  });

  it('treats a missing pool as the root pool', () => {
    expect(getResourcePoolKey(undefined)).toBe(getResourcePoolKey({ parentId: null }));
  });
});
