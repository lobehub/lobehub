import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type DiscoverUserProfile } from '@/types/discover';

import { userSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import { initialUserSliceState } from './initialState';
import { userProfileQueryKey } from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getUserInfo: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const profile: DiscoverUserProfile = {
  agents: [],
  user: {
    avatarUrl: null,
    bannerUrl: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    description: null,
    displayName: 'Alice',
    id: 1,
    namespace: 'alice',
    socialLinks: null,
    type: null,
    userName: 'alice',
  },
};

/** The entry key `useUserProfile` derives in this test environment. */
const entryKey = (username: string) =>
  userProfileQueryKey({ locale: globalHelpers.getCurrentLanguage(), username });

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ ...initialUserSliceState });
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

describe('UserSlice (replica)', () => {
  describe('useUserProfile', () => {
    it('requests the community profile for the username', async () => {
      renderHook(() => useStore.getState().useUserProfile({ username: 'alice' }));

      const [call] = await syncCalls('discoverUserProfile');
      await call.fetcher();

      expect(discoverService.getUserInfo).toHaveBeenCalledWith({ username: 'alice' });
    });

    it('registers the network sync under the replica key of this entry', async () => {
      renderHook(() => useStore.getState().useUserProfile({ username: 'alice' }));

      const [call] = await syncCalls('discoverUserProfile');

      expect(call.key[1]).toBe('discoverUserProfile');
      expect(call.key[4]).toBe(entryKey('alice'));
    });

    it('keys each username as its own entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useUserProfile({ username: 'alice' }),
        useStore.getState().useUserProfile({ username: 'bob' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('does not register a sync — and reports no loading — without a username', async () => {
      const { result } = renderHook(() => useStore.getState().useUserProfile({ username: '' }));

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('discoverUserProfile')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() =>
        useStore.getState().useUserProfile({ username: 'alice' }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a value', () => {
      useStore.setState({ userProfileMap: { [entryKey('alice')]: profile } });

      const { result } = renderHook(() =>
        useStore.getState().useUserProfile({ username: 'alice' }),
      );

      expect(result.current.queryKey).toBe(entryKey('alice'));
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selector reads', async () => {
      renderHook(() => useStore.getState().useUserProfile({ username: 'alice' }));
      await fold('discoverUserProfile', profile);

      expect(userSelectors.userProfile(entryKey('alice'))(useStore.getState())).toEqual(profile);
    });

    it('leaves the entry absent when the server does not know the handle', async () => {
      renderHook(() => useStore.getState().useUserProfile({ username: 'ghost' }));
      await fold('discoverUserProfile', undefined);

      expect(userSelectors.userProfile(entryKey('ghost'))(useStore.getState())).toBeUndefined();
    });

    it('reads undefined for a disabled entry', () => {
      expect(userSelectors.userProfile(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per username and locale', () => {
      expect(userProfileQueryKey({ locale: 'en-US', username: 'a' })).toBe(
        userProfileQueryKey({ locale: 'en-US', username: 'a' }),
      );
      expect(userProfileQueryKey({ locale: 'en-US', username: 'a' })).not.toBe(
        userProfileQueryKey({ locale: 'en-US', username: 'b' }),
      );
      expect(userProfileQueryKey({ locale: 'en-US', username: 'a' })).not.toBe(
        userProfileQueryKey({ locale: 'zh-CN', username: 'a' }),
      );
    });
  });
});
