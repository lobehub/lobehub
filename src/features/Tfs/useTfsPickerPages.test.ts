import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TfsData, TfsQuery } from '@/services/tfs';
import { tfsQueryKey } from '@/store/tfs/projection';

import { useTfsPickerPages } from './useTfsPickerPages';

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, TfsData>,
  validating: false,
}));
vi.mock('@/store/tfs/action', () => ({
  useTfsData: (query: TfsQuery) => ({
    data: mocks.data[tfsQueryKey(query)],
    isValidating: mocks.validating,
  }),
}));
vi.mock('@/store/tfs/store', () => ({
  useTfsStore: (selector: (state: { data: Record<string, TfsData> }) => unknown) => selector(mocks),
}));

describe('TFS picker pagination', () => {
  const query = { kind: 'branches' as const, binding: 'binding', project: 'P', repository: 'R' };
  beforeEach(() => {
    mocks.data = {
      [tfsQueryKey(query)]: { branches: { items: [{ name: 'main' }], next: 'second' } },
    };
    mocks.validating = false;
  });

  it('keeps previous options while loading, appends the next page and removes duplicates', () => {
    const { result, rerender } = renderHook(() => useTfsPickerPages(query, true));
    act(() => result.current.loadMore());
    expect(result.current.items).toEqual([{ name: 'main' }]);
    mocks.data[tfsQueryKey({ ...query, cursor: 'second' })] = {
      branches: { items: [{ name: 'main' }, { name: 'release' }] },
    };
    rerender();
    expect(result.current.items).toEqual([{ name: 'main' }, { name: 'release' }]);
    expect(result.current.next).toBeUndefined();
  });

  it('drops old pages when the repository or personal binding changes', () => {
    const { result, rerender } = renderHook((props) => useTfsPickerPages(props, true), {
      initialProps: query,
    });
    act(() => result.current.loadMore());
    rerender({ ...query, repository: 'other' });
    expect(result.current.items).toEqual([]);
    rerender({ ...query, binding: 'new-binding' });
    expect(result.current.items).toEqual([]);
  });

  it('does not advance a page while the current request is pending', () => {
    mocks.validating = true;
    const { result } = renderHook(() => useTfsPickerPages(query, true));
    act(() => result.current.loadMore());
    expect(result.current.items).toEqual([{ name: 'main' }]);
    expect(result.current.next).toBe('second');
  });
});
