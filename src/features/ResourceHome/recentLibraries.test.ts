import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { pickRecentLibraries, recordLibraryVisit, useLibraryVisits } from './recentLibraries';

const lib = (id: string, updatedAt: string) => ({ id, updatedAt });

describe('pickRecentLibraries', () => {
  const libraries = [
    lib('a', '2026-01-01'),
    lib('b', '2026-03-01'),
    lib('c', '2026-02-01'),
    lib('d', '2026-04-01'),
  ];

  it('orders opened libraries by their last visit', () => {
    const picked = pickRecentLibraries(libraries, { a: 300, c: 200 }, 2);

    expect(picked.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('fills the remaining slots with unvisited libraries by update time', () => {
    const picked = pickRecentLibraries(libraries, { a: 300 }, 3);

    expect(picked.map((item) => item.id)).toEqual(['a', 'd', 'b']);
  });

  it('ignores visits to libraries outside the current list', () => {
    const picked = pickRecentLibraries(libraries, { gone: 999 }, 1);

    expect(picked.map((item) => item.id)).toEqual(['d']);
  });
});

describe('recordLibraryVisit', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('updates subscribers with the latest visit', () => {
    const { result } = renderHook(() => useLibraryVisits());
    expect(result.current).toEqual({});

    act(() => recordLibraryVisit('kb-1', 100));
    act(() => recordLibraryVisit('kb-2', 200));

    expect(result.current).toEqual({ 'kb-1': 100, 'kb-2': 200 });
  });
});
