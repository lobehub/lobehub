import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { replicaKeys } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { socialService } from '@/services/social';

import { socialSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import { initialSocialSliceState } from './initialState';
import { followersResource, socialListKey, socialUserKey } from './projection';

vi.mock('@/services/social', () => ({
  socialService: {
    addFavorite: vi.fn(),
    checkFollowStatus: vi.fn(),
    follow: vi.fn(),
    getFollowCounts: vi.fn(),
    getFollowers: vi.fn(),
    getFollowing: vi.fn(),
    getUserFavoriteAgents: vi.fn(),
    getUserFavoritePlugins: vi.fn(),
    removeFavorite: vi.fn(),
    toggleLike: vi.fn(),
    unfollow: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const mutateMock = vi.mocked(mutate);

const makePage = <T>(item: T) => ({
  currentPage: 1,
  items: [item],
  pageSize: 20,
  totalCount: 1,
  totalPages: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ ...initialSocialSliceState });
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (name: string) => {
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

const fold = async (name: string, data: unknown) => {
  const [call] = await syncCalls(name);
  act(() => call.config.onSuccess!(data));
};

describe('SocialSlice (replica)', () => {
  describe('useFollowStatus', () => {
    it('requests the viewer-relative status for the target user', async () => {
      renderHook(() => useStore.getState().useFollowStatus(42));

      const [call] = await syncCalls('discoverFollowStatus');
      await call.fetcher();

      expect(socialService.checkFollowStatus).toHaveBeenCalledWith(42);
    });

    it('keys each target user as its own entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFollowStatus(1),
        useStore.getState().useFollowStatus(2),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('does not register a sync — and reports no loading — without a user id', async () => {
      const { result } = renderHook(() => useStore.getState().useFollowStatus(undefined));

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('discoverFollowStatus')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFollowStatus(42));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a value', () => {
      const key = socialUserKey({ userId: 42 });
      useStore.setState({ followStatusMap: { [key]: { isFollowing: true, isMutual: false } } });

      const { result } = renderHook(() => useStore.getState().useFollowStatus(42));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selector reads', async () => {
      renderHook(() => useStore.getState().useFollowStatus(42));
      await fold('discoverFollowStatus', { isFollowing: true, isMutual: true });

      const key = socialUserKey({ userId: 42 });
      expect(socialSelectors.followStatus(key)(useStore.getState())).toEqual({
        isFollowing: true,
        isMutual: true,
      });
    });
  });

  describe('useFollowCounts', () => {
    it('requests the target user counts and folds them into the view', async () => {
      renderHook(() => useStore.getState().useFollowCounts(7));

      const [call] = await syncCalls('discoverFollowCounts');
      await call.fetcher();
      expect(socialService.getFollowCounts).toHaveBeenCalledWith(7);

      await fold('discoverFollowCounts', { followersCount: 3, followingCount: 9 });
      expect(
        socialSelectors.followCounts(socialUserKey({ userId: 7 }))(useStore.getState()),
      ).toEqual({ followersCount: 3, followingCount: 9 });
    });
  });

  describe('paged lists', () => {
    it('requests a followers page with the page and page size', async () => {
      renderHook(() => useStore.getState().useFollowers(5, { page: 2, pageSize: 20 }));

      const [call] = await syncCalls('discoverFollowers');
      await call.fetcher();

      expect(socialService.getFollowers).toHaveBeenCalledWith(5, { page: 2, pageSize: 20 });
    });

    it('keys each page as its own entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFollowers(5, { page: 1 }),
        useStore.getState().useFollowers(5, { page: 2 }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('folds a favorites page into the view the selector reads', async () => {
      renderHook(() => useStore.getState().useFavoriteAgents(5, { page: 1, pageSize: 20 }));

      const [call] = await syncCalls('discoverFavoriteAgents');
      await call.fetcher();
      expect(socialService.getUserFavoriteAgents).toHaveBeenCalledWith(5, {
        page: 1,
        pageSize: 20,
      });

      const page = makePage({ identifier: 'agent-1' });
      await fold('discoverFavoriteAgents', page);

      const key = socialListKey({ page: 1, pageSize: 20, userId: 5 });
      expect(socialSelectors.favoriteAgents(key)(useStore.getState())).toEqual(page);
    });

    it('reports no value for a disabled list entry', () => {
      expect(socialSelectors.followers(undefined)(useStore.getState())).toBeUndefined();
      expect(socialSelectors.following(undefined)(useStore.getState())).toBeUndefined();
      expect(socialSelectors.favoritePlugins(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('follow', () => {
    const seedTarget = (followersCount = 2, followingCount = 7) => {
      const key = socialUserKey({ userId: 42 });
      useStore.setState({
        followCountsMap: { [key]: { followersCount, followingCount } },
        followStatusMap: { [key]: { isFollowing: false, isMutual: false } },
      });
      return key;
    };

    it('optimistically follows, commits, and refreshes the lists', async () => {
      const key = seedTarget();
      vi.mocked(socialService.follow).mockResolvedValue(undefined);

      await useStore.getState().follow(42);

      expect(socialService.follow).toHaveBeenCalledWith(42);
      expect(useStore.getState().followStatusMap[key]?.isFollowing).toBe(true);
      expect(useStore.getState().followCountsMap[key]?.followersCount).toBe(3);
      // The follower / following lists are refreshed after the toggle.
      const matchers = mutateMock.mock.calls
        .map(([matcher]) => matcher)
        .filter((matcher) => typeof matcher === 'function');
      const scope = followersResource.scope.get();
      expect(
        matchers.some((matcher) =>
          matcher(replicaKeys.sync('discoverFollowers', 1, scope, '42', {})),
        ),
      ).toBe(true);
      expect(
        matchers.some((matcher) =>
          matcher(replicaKeys.sync('discoverFollowing', 1, scope, '42', {})),
        ),
      ).toBe(true);
    });

    it('rolls the optimistic follow back when the server rejects it', async () => {
      const key = seedTarget();
      vi.mocked(socialService.follow).mockRejectedValue(new Error('nope'));

      await expect(useStore.getState().follow(42)).rejects.toThrow('nope');

      expect(useStore.getState().followStatusMap[key]?.isFollowing).toBe(false);
      expect(useStore.getState().followCountsMap[key]?.followersCount).toBe(2);
    });
  });

  describe('unfollow', () => {
    it('optimistically unfollows and floors the follower count at zero', async () => {
      const key = socialUserKey({ userId: 42 });
      useStore.setState({
        followCountsMap: { [key]: { followersCount: 0, followingCount: 7 } },
        followStatusMap: { [key]: { isFollowing: true, isMutual: false } },
      });
      vi.mocked(socialService.unfollow).mockResolvedValue(undefined);

      await useStore.getState().unfollow(42);

      expect(socialService.unfollow).toHaveBeenCalledWith(42);
      expect(useStore.getState().followStatusMap[key]?.isFollowing).toBe(false);
      expect(useStore.getState().followCountsMap[key]?.followersCount).toBe(0);
    });
  });

  describe('favorites', () => {
    it('refreshes the favorite replicas after adding a favorite', async () => {
      vi.mocked(socialService.addFavorite).mockResolvedValue(undefined);

      await useStore.getState().addFavorite('agent', 42);

      expect(socialService.addFavorite).toHaveBeenCalledWith('agent', 42);
      const matchers = mutateMock.mock.calls
        .map(([matcher]) => matcher)
        .filter((matcher) => typeof matcher === 'function');
      const scope = followersResource.scope.get();
      expect(
        matchers.some((matcher) =>
          matcher(replicaKeys.sync('discoverFavoriteAgents', 1, scope, 'key', {})),
        ),
      ).toBe(true);
      expect(
        matchers.some((matcher) =>
          matcher(replicaKeys.sync('discoverFavoritePlugins', 1, scope, 'key', {})),
        ),
      ).toBe(true);
    });
  });

  describe('toggleLike', () => {
    it('returns the server result', async () => {
      vi.mocked(socialService.toggleLike).mockResolvedValue({ liked: true });

      await expect(useStore.getState().toggleLike('plugin', 42)).resolves.toEqual({ liked: true });
      expect(socialService.toggleLike).toHaveBeenCalledWith('plugin', 42);
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(socialUserKey({ userId: 1 })).toBe(socialUserKey({ userId: 1 }));
      expect(socialUserKey({ userId: 1 })).not.toBe(socialUserKey({ userId: 2 }));

      expect(socialListKey({ page: 1, userId: 1 })).toBe(socialListKey({ page: 1, userId: 1 }));
      expect(socialListKey({ page: 1, userId: 1 })).not.toBe(socialListKey({ page: 2, userId: 1 }));
      expect(socialListKey({ page: 1, userId: 1 })).not.toBe(socialListKey({ page: 1, userId: 2 }));
    });
  });
});
