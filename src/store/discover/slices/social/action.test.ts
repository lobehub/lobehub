import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import type { FollowCounts } from '@/services/social';
import { socialService } from '@/services/social';

import { SocialActionImpl } from './action';

vi.mock('swr', () => ({
  default: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
}));

const mutateMock = vi.mocked(mutate);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SocialActionImpl', () => {
  describe('follow', () => {
    it('optimistically increments target follower count after following', async () => {
      vi.spyOn(socialService, 'follow').mockResolvedValue();
      const action = new SocialActionImpl(vi.fn(), vi.fn());

      await action.follow(42);

      expect(socialService.follow).toHaveBeenCalledWith(42);
      expect(mutateMock).toHaveBeenCalledWith(
        'follow-status-42',
        { isFollowing: true, isMutual: false },
        { revalidate: false },
      );

      const countsCall = mutateMock.mock.calls.find(([key]) => key === 'follow-counts-42');
      const updateCounts = countsCall?.[1] as
        | ((current?: FollowCounts) => FollowCounts)
        | undefined;

      expect(updateCounts?.({ followersCount: 2, followingCount: 7 })).toEqual({
        followersCount: 3,
        followingCount: 7,
      });
      expect(updateCounts?.()).toEqual({ followersCount: 1, followingCount: 0 });
    });
  });

  describe('unfollow', () => {
    it('optimistically decrements target follower count after unfollowing', async () => {
      vi.spyOn(socialService, 'unfollow').mockResolvedValue();
      const action = new SocialActionImpl(vi.fn(), vi.fn());

      await action.unfollow(42);

      expect(socialService.unfollow).toHaveBeenCalledWith(42);
      expect(mutateMock).toHaveBeenCalledWith(
        'follow-status-42',
        { isFollowing: false, isMutual: false },
        { revalidate: false },
      );

      const countsCall = mutateMock.mock.calls.find(([key]) => key === 'follow-counts-42');
      const updateCounts = countsCall?.[1] as
        | ((current?: FollowCounts) => FollowCounts)
        | undefined;

      expect(updateCounts?.({ followersCount: 2, followingCount: 7 })).toEqual({
        followersCount: 1,
        followingCount: 7,
      });
      expect(updateCounts?.({ followersCount: 0, followingCount: 7 })).toEqual({
        followersCount: 0,
        followingCount: 7,
      });
    });
  });
});
