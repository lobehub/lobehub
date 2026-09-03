import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useResetMemoryList, type ViewMode } from './useResetMemoryList';

describe('useResetMemoryList', () => {
  it('resets a timeline search when the backend uses its default sort', () => {
    const resetList = vi.fn();

    renderHook(() =>
      useResetMemoryList({
        query: 'late night',
        resetList,
        sort: undefined,
        viewMode: 'timeline',
      }),
    );

    expect(resetList).toHaveBeenCalledWith({ q: 'late night', sort: undefined });
  });

  it('does not reset when a view change keeps the effective sort unchanged', () => {
    const resetList = vi.fn();
    const initialProps: { viewMode: ViewMode } = { viewMode: 'timeline' };
    const { rerender } = renderHook(
      ({ viewMode }: { viewMode: ViewMode }) =>
        useResetMemoryList({
          query: 'late night',
          resetList,
          sort: undefined,
          viewMode,
        }),
      { initialProps },
    );

    rerender({ viewMode: 'grid' });

    expect(resetList).toHaveBeenCalledTimes(1);
  });

  it('resets when a view change activates an explicit grid sort', () => {
    const resetList = vi.fn();
    const initialProps: { viewMode: ViewMode } = { viewMode: 'timeline' };
    const { rerender } = renderHook(
      ({ viewMode }: { viewMode: ViewMode }) =>
        useResetMemoryList({
          query: 'late night',
          resetList,
          sort: 'scorePriority',
          viewMode,
        }),
      { initialProps },
    );

    rerender({ viewMode: 'grid' });

    expect(resetList).toHaveBeenNthCalledWith(2, {
      q: 'late night',
      sort: 'scorePriority',
    });
  });
});
