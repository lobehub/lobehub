import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChunkHighlights } from './useChunkHighlights';

const { useInfiniteQuery } = vi.hoisted(() => ({ useInfiniteQuery: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { chunk: { getChunksByFileId: { useInfiniteQuery } } },
}));

describe('useChunkHighlights', () => {
  beforeEach(() => {
    useInfiniteQuery.mockReset();
    useInfiniteQuery.mockReturnValue({ data: undefined });
  });

  it('flattens the chunk pages of the viewer own file', () => {
    useInfiniteQuery.mockReturnValue({
      data: { pages: [{ items: [{ id: 'c1' }] }, { items: [{ id: 'c2' }] }] },
    });

    const { result } = renderHook(() => useChunkHighlights('file_1', true));

    expect(useInfiniteQuery).toHaveBeenCalledWith(
      { id: 'file_1' },
      expect.objectContaining({ enabled: true }),
    );
    expect(result.current).toEqual([{ id: 'c1' }, { id: 'c2' }]);
  });

  it('skips the owner-scoped chunk query when disabled', () => {
    // A share visitor previewing the creator's file cannot read its chunks.
    renderHook(() => useChunkHighlights('file_1', false));

    expect(useInfiniteQuery).toHaveBeenCalledWith(
      { id: 'file_1' },
      expect.objectContaining({ enabled: false }),
    );
  });
});
