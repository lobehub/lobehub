import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as clientDataStore from '@/client-data';
import * as swr from '@/libs/swr';
import { clientDataKeys, recentKeys } from '@/libs/swr/keys';
import * as cacheScope from '@/libs/swr/useCacheScope';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { recentService } from '@/services/recent';
import { useHomeStore } from '@/store/home';
import { initialRecentState } from '@/store/home/slices/recent/initialState';

const item = (id: string, title: string, type: 'task' | 'topic' = 'topic'): RecentItem =>
  ({ id, title, type }) as unknown as RecentItem;

const clientDataActions = {
  updateTopicEntityTitle: vi.fn(),
};

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
  vi.clearAllMocks();
  useHomeStore.setState({ ...initialRecentState });
  vi.spyOn(clientDataStore, 'getClientDataStoreState').mockReturnValue(clientDataActions as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecentActionImpl', () => {
  describe('useFetchRecents onData scope guard', () => {
    it('fetches only document and task recents without polling', async () => {
      const swrSpy = vi.spyOn(swr, 'useClientDataSWRWithSync').mockReturnValue({
        data: undefined,
        isValidating: false,
        mutate: vi.fn(),
      } as any);
      const getAllSpy = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);

      renderHook(() => useHomeStore.getState().useFetchRecents(true, 10, 'user-1:ws-A'));

      expect(swrSpy).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), {
        onData: expect.any(Function),
      });

      const fetcher = swrSpy.mock.calls[0][1] as () => Promise<RecentItem[]>;
      await fetcher();

      expect(getAllSpy).toHaveBeenCalledWith(11, ['document', 'task']);
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
    it('renames the legacy projection and commits the canonical Topic entity', () => {
      useHomeStore.setState({ recents: [item('a', 'old'), item('b', 'keep')] });
      const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:workspace-1');

      act(() => {
        useHomeStore.getState().updateRecentTitle('a', 'new');
      });

      expect(useHomeStore.getState().recents).toEqual([item('a', 'new'), item('b', 'keep')]);
      expect(clientDataActions.updateTopicEntityTitle).toHaveBeenCalledWith(
        'user-1:workspace-1',
        'a',
        'new',
      );
      expect(mutateSpy).not.toHaveBeenCalled();
    });

    it('does not reinterpret a Task recent as a Topic entity mutation', () => {
      useHomeStore.setState({ recents: [item('task-1', 'old', 'task')] });

      act(() => {
        useHomeStore.getState().updateRecentTitle('task-1', 'new');
      });

      expect(useHomeStore.getState().recents).toEqual([item('task-1', 'new', 'task')]);
      expect(clientDataActions.updateTopicEntityTitle).not.toHaveBeenCalled();
    });
  });

  describe('refreshRecents', () => {
    it('revalidates both the list and the drawer SWR caches', async () => {
      const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);

      await act(async () => {
        await useHomeStore.getState().refreshRecents();
      });

      expect(mutateSpy).toHaveBeenCalledTimes(3);
      const matcher = mutateSpy.mock.calls[0][0] as (key: unknown) => boolean;
      expect(matcher(recentKeys.list(true, 10, 's'))).toBe(true);
      const entityMatcher = mutateSpy.mock.calls[2][0] as (key: unknown) => boolean;
      expect(entityMatcher(clientDataKeys.recentTopics('s', 9, 'mine'))).toBe(true);
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
