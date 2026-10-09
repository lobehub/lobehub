import { describe, expect, it } from 'vitest';

import { getResourceQueryKey, isOptimisticRowInRequestedPool } from './utils';

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

describe('isOptimisticRowInRequestedPool', () => {
  it('matches a row created in the pool on screen, including a re-sort', () => {
    const key = getResourceQueryKey({ parentId: 'folder-a' });

    expect(isOptimisticRowInRequestedPool(key, { parentId: 'folder-a' })).toBe(true);
    expect(
      isOptimisticRowInRequestedPool(key, {
        parentId: 'folder-a',
        sorter: 'size',
        sortType: 'asc',
      }),
    ).toBe(true);
  });

  it('rejects a row from another folder or library', () => {
    const key = getResourceQueryKey({ libraryId: 'kb-1', parentId: 'folder-a' });

    expect(isOptimisticRowInRequestedPool(key, { parentId: 'folder-b' })).toBe(false);
    expect(isOptimisticRowInRequestedPool(key, { libraryId: 'kb-2' })).toBe(false);
    expect(isOptimisticRowInRequestedPool(key, undefined)).toBe(false);
    expect(isOptimisticRowInRequestedPool(undefined, { parentId: 'folder-a' })).toBe(false);
  });
});
