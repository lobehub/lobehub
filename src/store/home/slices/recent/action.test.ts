import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as swr from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import * as cacheScope from '@/libs/swr/useCacheScope';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { useHomeStore } from '@/store/home';
import { initialRecentState } from '@/store/home/slices/recent/initialState';

const item = (id: string, title: string): RecentItem => ({ id, title }) as unknown as RecentItem;

/**
 * Render `useFetchRecents` with `useClientDataSWRWithSync` stubbed so we can grab
 * the `onData` sync callback and drive the scope guard directly.
 */
const captureOnData = (scope: string) => {
  let onData: ((data: RecentItem[]) => void) | undefined;
  vi.spyOn(swr, 'useClientDataSWRWithSync').mockImplementation(((
    _key: unknown,
    _fetcher: unknown,
    opts: any,
  ) => {
    onData = opts?.onData;
    return { data: undefined, isValidating: false, mutate: vi.fn() };
  }) as any);

  renderHook(() => useHomeStore.getState().useFetchRecents(true, 10, scope));
  return () => onData;
};

beforeEach(() => {
  useHomeStore.setState({ ...initialRecentState });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecentActionImpl', () => {
  describe('useFetchRecents onData scope guard', () => {
    it('does not poll recents periodically', () => {
      const swrSpy = vi.spyOn(swr, 'useClientDataSWRWithSync').mockReturnValue({
        data: undefined,
        isValidating: false,
        mutate: vi.fn(),
      } as any);

      renderHook(() => useHomeStore.getState().useFetchRecents(true, 10, 'user-1:ws-A'));

      expect(swrSpy).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), {
        onData: expect.any(Function),
      });
    });

    it('applies data for the matching scope and tags recentsScope', () => {
      vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:ws-A');
      const getOnData = captureOnData('user-1:ws-A');

      act(() => getOnData()!([item('a', 'A')]));

      const state = useHomeStore.getState();
      expect(state.recents).toEqual([item('a', 'A')]);
      expect(state.isRecentsInit).toBe(true);
      expect(state.recentsScope).toBe('user-1:ws-A');
    });

    it('ignores data whose scope no longer matches the active cache scope', () => {
      // active scope moved to ws-A, but this callback belongs to the stale ws-B key
      vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:ws-A');
      const getOnData = captureOnData('user-1:ws-B');

      act(() => getOnData()!([item('stale', 'STALE')]));

      const state = useHomeStore.getState();
      expect(state.recents).toEqual([]);
      expect(state.isRecentsInit).toBe(false);
      expect(state.recentsScope).toBeNull();
    });

    it('keeps data isolated across users in the same workspace', () => {
      useHomeStore.setState({
        isRecentsInit: true,
        recents: [item('u1', 'user1 item')],
        recentsScope: 'user-1:ws-A',
      });
      // now signed in as user-2 in the same workspace
      vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-2:ws-A');
      const getOnData = captureOnData('user-2:ws-A');

      act(() => getOnData()!([item('u2', 'user2 item')]));

      const state = useHomeStore.getState();
      expect(state.recents).toEqual([item('u2', 'user2 item')]);
      expect(state.recentsScope).toBe('user-2:ws-A');
    });

    it('skips redundant set when init, same scope and equal data', () => {
      useHomeStore.setState({
        isRecentsInit: true,
        recents: [item('a', 'A')],
        recentsScope: 'user-1:ws-A',
      });
      vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:ws-A');
      const getOnData = captureOnData('user-1:ws-A');

      // an early return means no set() runs, so the state object keeps its identity
      const before = useHomeStore.getState();
      act(() => getOnData()!([item('a', 'A')]));

      expect(useHomeStore.getState()).toBe(before);
    });
  });

  describe('updateRecentTitle', () => {
    it('renames in the store mirror and patches the scoped SWR caches', () => {
      useHomeStore.setState({ recents: [item('a', 'old'), item('b', 'keep')] });
      const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);

      act(() => {
        useHomeStore.getState().updateRecentTitle('a', 'new');
      });

      expect(useHomeStore.getState().recents).toEqual([item('a', 'new'), item('b', 'keep')]);
      // both the list and the drawer SWR caches get a non-revalidating patch
      expect(mutateSpy).toHaveBeenCalledTimes(2);
      expect(mutateSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
        revalidate: false,
      });
    });

    it('SWR cache updater matches keys by root and renames the target item only', () => {
      useHomeStore.setState({ recents: [] });
      let updater: (items?: RecentItem[]) => RecentItem[] | undefined = () => undefined;
      const matchers: Array<(key: unknown) => boolean> = [];
      vi.spyOn(swr, 'mutate').mockImplementation(((match: any, fn: any) => {
        matchers.push(match);
        updater = fn;
        return Promise.resolve(undefined);
      }) as any);

      act(() => {
        useHomeStore.getState().updateRecentTitle('a', 'new');
      });

      expect(matchers[0](recentKeys.list(true, 10, 's'))).toBe(true);
      expect(matchers[0](['other:key'])).toBe(false);
      expect(updater([item('a', 'old'), item('b', 'keep')])).toEqual([
        item('a', 'new'),
        item('b', 'keep'),
      ]);
      expect(updater(undefined)).toBeUndefined();
    });
  });

  describe('refreshRecents', () => {
    it('revalidates both the list and the drawer SWR caches', async () => {
      const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);

      await act(async () => {
        await useHomeStore.getState().refreshRecents();
      });

      expect(mutateSpy).toHaveBeenCalledTimes(2);
      const matcher = mutateSpy.mock.calls[0][0] as (key: unknown) => boolean;
      expect(matcher(recentKeys.list(true, 10, 's'))).toBe(true);
    });
  });

  describe('drawer visibility', () => {
    it('opens and closes the all-recents drawer', () => {
      act(() => useHomeStore.getState().openAllRecentsDrawer());
      expect(useHomeStore.getState().allRecentsDrawerOpen).toBe(true);

      act(() => useHomeStore.getState().closeAllRecentsDrawer());
      expect(useHomeStore.getState().allRecentsDrawerOpen).toBe(false);
    });
  });
});
