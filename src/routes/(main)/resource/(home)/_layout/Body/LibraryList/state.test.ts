import { describe, expect, it } from 'vitest';

import { getLibraryListAsyncState } from './state';

describe('getLibraryListAsyncState', () => {
  it('treats fallback empty data during validation as unsettled loading', () => {
    const state = getLibraryListAsyncState({
      data: [],
      isLoading: false,
      isValidating: true,
    });

    expect(state).toEqual({
      boundaryData: undefined,
      isEmpty: true,
      isLoading: true,
    });
  });

  it('keeps existing rows visible during background validation', () => {
    const data = [{ id: 'kb-1' }];

    const state = getLibraryListAsyncState({
      data,
      isLoading: false,
      isValidating: true,
    });

    expect(state).toEqual({
      boundaryData: data,
      isEmpty: false,
      isLoading: false,
    });
  });
});
