import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type SkillCommentListResponse } from '@/types/discover';

import { type FetchCommentPage, useCommentPages } from './useCommentPages';

const page = (
  ids: string[],
  meta: Partial<SkillCommentListResponse> = {},
): SkillCommentListResponse =>
  ({
    currentPage: 1,
    items: ids.map((id) => ({ id })),
    totalCount: ids.length,
    totalPages: 1,
    ...meta,
  }) as unknown as SkillCommentListResponse;

const ids = (items: { id: unknown }[]) => items.map((item) => item.id);

describe('useCommentPages', () => {
  it('reseeds from a refreshed first page that arrives after mount', () => {
    const fetchMore = vi.fn() as unknown as FetchCommentPage;
    const { result, rerender } = renderHook(({ data }) => useCommentPages(data, fetchMore), {
      initialProps: { data: page(['cached']) },
    });
    expect(ids(result.current.items)).toEqual(['cached']);

    // Revalidation replaces the persisted first page with fresh content.
    rerender({ data: page(['new', 'cached']) });

    expect(ids(result.current.items)).toEqual(['new', 'cached']);
    expect(result.current.totalCount).toBe(2);
  });

  it('keeps later pages when the first page refreshes with identical content', async () => {
    const fetchMore = vi
      .fn()
      .mockResolvedValue(page(['two'], { currentPage: 2, totalCount: 2, totalPages: 2 }));
    const { result, rerender } = renderHook(({ data }) => useCommentPages(data, fetchMore), {
      initialProps: { data: page(['one'], { totalCount: 2, totalPages: 2 }) },
    });

    await act(async () => {
      result.current.loadMore();
    });
    expect(ids(result.current.items)).toEqual(['one', 'two']);

    rerender({ data: page(['one'], { totalCount: 2, totalPages: 2 }) });

    expect(ids(result.current.items)).toEqual(['one', 'two']);
    expect(result.current.currentPage).toBe(2);
  });
});
