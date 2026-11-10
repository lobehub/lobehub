/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';

import { useMarketSkillList } from './useMarketSkillList';

vi.mock('@/libs/swr', async () => ({ useClientDataSWR: (await import('swr')).default }));
vi.mock('@/services/discover', () => ({ discoverService: { getSkillList: vi.fn() } }));
vi.mock('@/store/global/helpers', () => ({ globalHelpers: { getCurrentLanguage: () => 'en-US' } }));

const response = (identifier: string, page = 1, totalPages = 1) => ({
  currentPage: page,
  items: [{ identifier }],
  pageSize: 20,
  totalCount: totalPages,
  totalPages,
});
const wrapper = () => {
  const cache = new Map();
  return ({ children }: PropsWithChildren) =>
    createElement(
      SWRConfig,
      {
        value: { provider: () => cache, shouldRetryOnError: false },
      },
      children,
    );
};

describe('useMarketSkillList', () => {
  beforeEach(() => {
    vi.mocked(discoverService.getSkillList).mockReset();
  });

  it('restores cached results when returning to a previous term and clearing search', async () => {
    vi.mocked(discoverService.getSkillList).mockImplementation(
      async (params) => response(params?.q || 'all') as any,
    );
    const { result, rerender } = renderHook(({ q }) => useMarketSkillList(q), {
      initialProps: { q: '' },
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items[0]?.identifier).toBe('all'));
    for (const q of ['meeting', 'weekly', 'meeting', '']) {
      rerender({ q });
      await waitFor(() => expect(result.current.items[0]?.identifier).toBe(q || 'all'));
    }
    expect(discoverService.getSkillList).toHaveBeenCalledTimes(3);
  });

  it('starts a new search on page one without carrying over accumulated pages', async () => {
    vi.mocked(discoverService.getSkillList).mockImplementation(
      async (params) => response(`${params?.q}-${params?.page}`, params?.page, 2) as any,
    );
    const { result, rerender } = renderHook(({ q }) => useMarketSkillList(q), {
      initialProps: { q: 'meeting' },
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    rerender({ q: 'weekly' });
    await waitFor(() =>
      expect(result.current.items.map((item) => item.identifier)).toEqual(['weekly-1']),
    );
    expect(result.current.page).toBe(1);
  });

  it('keeps loaded items after a next-page failure and recovers through retry', async () => {
    let fail = true;
    vi.mocked(discoverService.getSkillList).mockImplementation(async (params) => {
      if (params?.page === 2 && fail) throw new Error('rate limited');
      return response(`item-${params?.page}`, params?.page, 2) as any;
    });
    const { result } = renderHook(() => useMarketSkillList('meeting'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.items.map((item) => item.identifier)).toEqual(['item-1']);
    act(() => result.current.loadMore());
    expect(result.current.page).toBe(2);
    fail = false;
    act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current.items.map((item) => item.identifier)).toEqual(['item-1', 'item-2']),
    );
  });

  it('ignores a previous search that finishes after the current search', async () => {
    let finishPrevious!: (value: any) => void;
    vi.mocked(discoverService.getSkillList).mockImplementation(async (params) =>
      params?.q === 'meeting'
        ? new Promise((resolve) => {
            finishPrevious = resolve;
          })
        : (response('weekly') as any),
    );
    const { result, rerender } = renderHook(({ q }) => useMarketSkillList(q), {
      initialProps: { q: 'meeting' },
      wrapper: wrapper(),
    });
    await waitFor(() => expect(finishPrevious).toBeDefined());
    act(() => result.current.loadMore());
    expect(result.current.page).toBe(1);
    rerender({ q: 'weekly' });
    await waitFor(() => expect(result.current.items[0]?.identifier).toBe('weekly'));
    await act(async () => finishPrevious(response('meeting')));
    expect(result.current.items[0]?.identifier).toBe('weekly');
  });
});
