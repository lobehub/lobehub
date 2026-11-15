/**
 * @vitest-environment happy-dom
 *
 * The Skill Store's market tab reads the discover `skillList` replica: a
 * reopened store paints the last confirmed first page before the network
 * answers, a hydrated empty page is not confirmed until the server answers,
 * and a failed refresh keeps the skills on screen.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';
import { SkillSorts } from '@/types/discover';

import { useMarketSkillList } from './useMarketSkillList';

vi.mock('@/store/global/helpers', () => ({
  globalHelpers: { getCurrentLanguage: () => 'en-US' },
}));

const response = (identifiers: string[]) => ({
  currentPage: 1,
  items: identifiers.map((identifier) => ({ identifier })),
  pageSize: 20,
  totalCount: identifiers.length,
  totalPages: 1,
});

// Entry key of the first page: the market query plus the UI language.
const firstPageKey = (q?: string) =>
  stableQueryKey({ locale: 'en-US', page: 1, pageSize: 20, q, sort: SkillSorts.InstallCount });

describe('useMarketSkillList (replica)', () => {
  const { persist } = useReplicaHarness('skill-store');

  it('paints the persisted first page before the network answers, then refreshes it', async () => {
    await persist('skillList', firstPageKey(), response(['cached-skill']));
    const next = deferred<unknown>();
    vi.spyOn(discoverService, 'getSkillList').mockImplementation(() => next.promise as never);

    const { result } = renderHook(() => useMarketSkillList(), { wrapper });

    await waitFor(() => expect(result.current.items[0]?.identifier).toBe('cached-skill'));
    expect(result.current.isLoading).toBe(false);

    await act(async () => next.resolve(response(['fresh-skill'])));
    await waitFor(() => expect(result.current.items[0]?.identifier).toBe('fresh-skill'));
    expect(result.current.isConfirmed).toBe(true);
  });

  it('treats a hydrated empty page as unconfirmed until the server answers', async () => {
    await persist('skillList', firstPageKey(), response([]));
    const next = deferred<unknown>();
    vi.spyOn(discoverService, 'getSkillList').mockImplementation(() => next.promise as never);

    const { result } = renderHook(() => useMarketSkillList(), { wrapper });

    await waitFor(() => expect(result.current.page).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.items).toEqual([]);
    expect(result.current.isConfirmed).toBe(false);

    await act(async () => next.resolve(response([])));
    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
  });

  it('keeps the persisted skills when a refresh fails', async () => {
    await persist('skillList', firstPageKey(), response(['cached-skill']));
    vi.spyOn(discoverService, 'getSkillList').mockRejectedValue(new Error('rate limited'));

    const { result } = renderHook(() => useMarketSkillList(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.items[0]?.identifier).toBe('cached-skill');
  });

  it("never paints another identity's skills", async () => {
    await persist('skillList', firstPageKey(), response(['theirs']), 'someone-else:personal');
    vi.spyOn(discoverService, 'getSkillList').mockImplementation(pending);

    const { result } = renderHook(() => useMarketSkillList(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('sends one request when the store tabs read the same page', async () => {
    const getSkillList = vi
      .spyOn(discoverService, 'getSkillList')
      .mockResolvedValue(response(['shared']) as never);

    const { result } = renderHook(() => [useMarketSkillList(), useMarketSkillList()], {
      wrapper,
    });

    await waitFor(() => expect(result.current[1].items[0]?.identifier).toBe('shared'));
    expect(getSkillList).toHaveBeenCalledTimes(1);
  });
});
