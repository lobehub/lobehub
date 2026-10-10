import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { SkillListResponse } from '@/types/discover';
import { SkillSorts } from '@/types/discover';

import { skillSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import {
  skillCategoriesQueryKey,
  skillCommentsQueryKey,
  skillDetailQueryKey,
  skillListQueryKey,
  skillRatingDistributionQueryKey,
  skillRelatedQueryKey,
} from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getSkillCategories: vi.fn(),
    getSkillComments: vi.fn(),
    getSkillDetail: vi.fn(),
    getSkillList: vi.fn(),
    getSkillRatingDistribution: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const listItem = (identifier: string) => ({ identifier, name: identifier }) as any;

const makeList = (identifier = 'skill-1'): SkillListResponse =>
  ({
    currentPage: 1,
    items: [listItem(identifier)],
    pageSize: 21,
    totalCount: 1,
    totalPages: 1,
  }) as any;

const emptySkillState = () => ({
  skillCategoriesMap: {},
  skillCategoriesReplica: createReplicaState(),
  skillCommentsMap: {},
  skillCommentsReplica: createReplicaState(),
  skillDetailMap: {},
  skillDetailReplica: createReplicaState(),
  skillListMap: {},
  skillListReplica: createReplicaState(),
  skillRatingDistributionMap: {},
  skillRatingDistributionReplica: createReplicaState(),
  skillRelatedMap: {},
  skillRelatedReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptySkillState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (
  name:
    | 'skillCategories'
    | 'skillComments'
    | 'skillDetail'
    | 'skillList'
    | 'skillRatingDistribution'
    | 'skillRelated',
) => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, fetcher, config]) => ({
      config: config as { onSuccess?: (data: unknown) => void },
      fetcher: fetcher as () => Promise<any>,
      key: key as unknown[],
    }));
};

describe('SkillSlice (replica)', () => {
  describe('useFetchSkillList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchSkillList({ q: 'gpt' }));

      const [call] = await syncCalls('skillList');
      await call.fetcher();

      expect(discoverService.getSkillList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 21,
        q: 'gpt',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchSkillList({ page: 1 }),
        useStore.getState().useFetchSkillList({ page: 2 }),
        useStore.getState().useFetchSkillList({ category: 'git-github' }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchSkillList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('skillList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchSkillList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = skillListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      useStore.setState({ skillListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchSkillList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchSkillList({ page: 1 }));
      const [call] = await syncCalls('skillList');
      act(() => call.config.onSuccess!(response));

      const key = skillListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      expect(skillSelectors.skillList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchSkillDetail', () => {
    it('requests the detail with identifier and locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchSkillDetail({ identifier: 'github.acme.a' }));

      const [call] = await syncCalls('skillDetail');
      await call.fetcher();

      expect(discoverService.getSkillDetail).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'github.acme.a' }),
      );
    });

    it('passes the pinned version through to the detail request', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchSkillDetail({ identifier: 'github.acme.a', version: '1.2.0' }),
      );

      const [call] = await syncCalls('skillDetail');
      await call.fetcher();

      expect(discoverService.getSkillDetail).toHaveBeenCalledWith({
        identifier: 'github.acme.a',
        version: '1.2.0',
      });
    });

    it('keys the detail by identifier, so a different identifier is a different entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchSkillDetail({ identifier: 'github.acme.a' }),
        useStore.getState().useFetchSkillDetail({ identifier: 'github.acme.b' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('disables the sync for a raw-URL identifier and reports no loading', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchSkillDetail({ identifier: 'url.example.com.foo' }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('skillDetail')).toHaveLength(0);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchSkillDetail({ identifier: 'github.acme.a' }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });
  });

  describe('useSkillCategories', () => {
    it('requests category counts with the search term and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useSkillCategories({ q: 'gpt' }));

      const [call] = await syncCalls('skillCategories');
      await call.fetcher();

      expect(discoverService.getSkillCategories).toHaveBeenCalledWith({
        locale: 'en-US',
        q: 'gpt',
      });
    });

    it('skips the request when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useSkillCategories({}, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('skillCategories')).toHaveLength(0);
    });

    it('falls back to an empty list when no category entry is loaded', () => {
      expect(skillSelectors.skillCategories(undefined)(useStore.getState())).toEqual([]);
      expect(skillSelectors.skillRelated(undefined)(useStore.getState())).toEqual([]);
      expect(skillSelectors.skillList(undefined)(useStore.getState())).toBeUndefined();
      expect(skillSelectors.skillDetail(undefined)(useStore.getState())).toBeUndefined();
      expect(skillSelectors.skillComments(undefined)(useStore.getState())).toBeUndefined();
      expect(
        skillSelectors.skillRatingDistribution(undefined)(useStore.getState()),
      ).toBeUndefined();
    });
  });

  describe('useFetchSkillComments', () => {
    it('requests the first comment page with the identifier and paging params', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchSkillComments({
          identifier: 'github.acme.a',
          order: 'desc',
          page: 1,
          sort: 'createdAt',
        }),
      );

      const [call] = await syncCalls('skillComments');
      await call.fetcher();

      expect(discoverService.getSkillComments).toHaveBeenCalledWith({
        identifier: 'github.acme.a',
        order: 'desc',
        page: 1,
        sort: 'createdAt',
      });
    });

    it('disables the sync without an identifier', async () => {
      const { result } = renderHook(() => useStore.getState().useFetchSkillComments({ page: 1 }));

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('skillComments')).toHaveLength(0);
    });
  });

  describe('useFetchSkillRatingDistribution', () => {
    it('requests the rating distribution for the identifier', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchSkillRatingDistribution('github.acme.a'));

      const [call] = await syncCalls('skillRatingDistribution');
      await call.fetcher();

      expect(discoverService.getSkillRatingDistribution).toHaveBeenCalledWith('github.acme.a');
    });
  });

  describe('useFetchRelatedSkills', () => {
    it('fetches same-category recommended skills, dropping the skill itself and capping at 6', async () => {
      const { discoverService } = await import('@/services/discover');
      vi.mocked(discoverService.getSkillList).mockResolvedValue({
        items: [
          listItem('github.acme.skill-a'),
          ...Array.from({ length: 6 }, (_, i) => listItem(`github.acme.other-${i}`)),
        ],
      } as any);

      renderHook(() =>
        useStore.getState().useFetchRelatedSkills({
          category: 'productivity-tasks',
          identifier: 'github.acme.skill-a',
        }),
      );

      const [call] = await syncCalls('skillRelated');
      const related = await call.fetcher();

      expect(discoverService.getSkillList).toHaveBeenCalledWith({
        category: 'productivity-tasks',
        page: 1,
        pageSize: 7,
        sort: SkillSorts.Recommended,
      });
      expect(related).toHaveLength(6);
      expect(related.map((i: any) => i.identifier)).not.toContain('github.acme.skill-a');
    });

    it('caps at 6 even when the skill itself is not in the page', async () => {
      const { discoverService } = await import('@/services/discover');
      vi.mocked(discoverService.getSkillList).mockResolvedValue({
        items: Array.from({ length: 7 }, (_, i) => listItem(`github.acme.other-${i}`)),
      } as any);

      renderHook(() =>
        useStore.getState().useFetchRelatedSkills({
          category: 'productivity-tasks',
          identifier: 'github.acme.skill-a',
        }),
      );

      const [call] = await syncCalls('skillRelated');
      expect(await call.fetcher()).toHaveLength(6);
    });

    it('does not fetch without a category', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchRelatedSkills({ identifier: 'github.acme.skill-a' }),
      );

      expect(await syncCalls('skillRelated')).toHaveLength(0);
      expect(discoverService.getSkillList).not.toHaveBeenCalled();
    });

    it('does not fetch without an identifier', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchRelatedSkills({ category: 'productivity-tasks' }),
      );

      expect(await syncCalls('skillRelated')).toHaveLength(0);
      expect(discoverService.getSkillList).not.toHaveBeenCalled();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(skillListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 })).toBe(
        skillListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 }),
      );
      expect(skillDetailQueryKey({ identifier: 'a' })).not.toBe(
        skillDetailQueryKey({ identifier: 'b' }),
      );
      expect(skillCategoriesQueryKey({ q: 'a' })).not.toBe(skillCategoriesQueryKey({}));
      expect(skillCommentsQueryKey({ identifier: 'a', page: 1 })).not.toBe(
        skillCommentsQueryKey({ identifier: 'a', page: 2 }),
      );
      expect(skillRatingDistributionQueryKey({ identifier: 'a' })).not.toBe(
        skillRatingDistributionQueryKey({ identifier: 'b' }),
      );
      expect(skillRelatedQueryKey({ category: 'a', identifier: 'b' })).not.toBe(
        skillRelatedQueryKey({ category: 'a', identifier: 'c' }),
      );
    });
  });
});
