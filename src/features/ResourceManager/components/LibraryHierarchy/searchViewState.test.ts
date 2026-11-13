import { describe, expect, it } from 'vitest';

import { resolveSearchViewState } from './searchViewState';

const params = { libraryId: 'kb-1', pageSize: 50, q: 'report' };
const page = (items: unknown[]) =>
  ({
    currentPage: 0,
    hasMore: false,
    items,
    pageSize: 50,
    searchParams: params,
    total: items.length,
  }) as any;
const row = { id: 'file-1', name: 'Report', parentId: null };

describe('resolveSearchViewState', () => {
  it('does not hand an EMPTY persisted page to the boundary, so a failed reopen can show the error', () => {
    const state = resolveSearchViewState({
      entry: page([]),
      error: new Error('offline'),
      isWaitingForDebounce: false,
    });

    expect(state.data).toBeUndefined();
    expect(state.isEmpty).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('keeps a non-empty persisted page on screen while a background refresh fails', () => {
    const cached = page([row]);
    const state = resolveSearchViewState({
      entry: cached,
      error: new Error('offline'),
      isWaitingForDebounce: false,
    });

    expect(state.data).toBe(cached);
    expect(state.isEmpty).toBe(false);
  });

  it('reports no results only once the request settled with nothing', () => {
    const state = resolveSearchViewState({
      entry: page([]),
      error: undefined,
      isWaitingForDebounce: false,
    });

    expect(state.data).toBeUndefined();
    expect(state.isEmpty).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('loads while the first request is in flight, and across the debounce gap', () => {
    expect(
      resolveSearchViewState({ entry: undefined, error: undefined, isWaitingForDebounce: false })
        .isLoading,
    ).toBe(true);
    expect(
      resolveSearchViewState({
        entry: page([row]),
        error: undefined,
        isWaitingForDebounce: true,
      }).isLoading,
    ).toBe(true);
  });

  it('shows a failed first load as an error, not as loading or no results', () => {
    const state = resolveSearchViewState({
      entry: undefined,
      error: new Error('offline'),
      isWaitingForDebounce: false,
    });

    expect(state.data).toBeUndefined();
    expect(state.isEmpty).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});
