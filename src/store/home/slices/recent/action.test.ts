import type { RecentItem } from '@lobechat/types';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as swr from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import * as cacheScope from '@/libs/swr/useCacheScope';
import { useHomeStore } from '@/store/home';
import { initialRecentState } from '@/store/home/slices/recent/initialState';

const item = (id: string, title: string, type: RecentItem['type'] = 'task'): RecentItem =>
  ({ id, title, type }) as RecentItem;

beforeEach(() => {
  useHomeStore.setState({ ...initialRecentState });
  vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:ws-A');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('RecentActionImpl', () => {
  it('normalizes server data into a scoped ordered index and entity map', () => {
    act(() => {
      useHomeStore
        .getState()
        .ingestRecents('user-1:ws-A', [item('a', 'A'), item('b', 'B')], 10, 100);
    });

    const state = useHomeStore.getState();
    expect(state.recentIndexesByScope['user-1:ws-A']).toEqual({
      limit: 10,
      observedAt: 100,
      refs: ['task:a', 'task:b'],
    });
    expect(state.recentEntitiesByScope['user-1:ws-A']?.['task:a']).toEqual(item('a', 'A'));
  });

  it('ignores a response after the active cache scope changed', () => {
    act(() => {
      useHomeStore.getState().ingestRecents('user-1:ws-B', [item('stale', 'STALE')], 10, 100);
    });

    expect(useHomeStore.getState().recentIndexesByScope['user-1:ws-B']).toBeUndefined();
  });

  it('does not let an older response overwrite a newer index', () => {
    act(() => {
      const store = useHomeStore.getState();
      store.ingestRecents('user-1:ws-A', [item('new', 'New')], 10, 200);
      store.ingestRecents('user-1:ws-A', [item('old', 'Old')], 10, 100);
    });

    expect(useHomeStore.getState().recentIndexesByScope['user-1:ws-A']?.refs).toEqual(['task:new']);
  });

  it('preserves the tail when a smaller sidebar response follows a larger drawer response', () => {
    act(() => {
      const store = useHomeStore.getState();
      store.ingestRecents('user-1:ws-A', [item('a', 'A'), item('b', 'B'), item('c', 'C')], 50, 100);
      store.ingestRecents('user-1:ws-A', [item('a', 'A2')], 1, 200);
    });

    expect(useHomeStore.getState().recentIndexesByScope['user-1:ws-A']?.refs).toEqual([
      'task:a',
      'task:b',
      'task:c',
    ]);
  });

  it('keeps optimistic title separate and rolls it back to confirmed data', () => {
    act(() => {
      const store = useHomeStore.getState();
      store.ingestRecents('user-1:ws-A', [item('a', 'Old')], 10, 100);
      store.setRecentTitleOptimistic('user-1:ws-A', 'task', 'a', 'Draft');
    });

    const selector = (state: ReturnType<typeof useHomeStore.getState>) => {
      const ref = 'task:a' as const;
      const confirmed = state.recentEntitiesByScope['user-1:ws-A']?.[ref];
      const overlay = state.recentOptimisticTitlesByScope['user-1:ws-A']?.[ref];
      return overlay === undefined ? confirmed : { ...confirmed, title: overlay };
    };
    expect(selector(useHomeStore.getState())?.title).toBe('Draft');
    expect(useHomeStore.getState().recentEntitiesByScope['user-1:ws-A']?.['task:a']?.title).toBe(
      'Old',
    );

    act(() => useHomeStore.getState().rollbackRecentTitle('user-1:ws-A', 'task', 'a'));
    expect(selector(useHomeStore.getState())?.title).toBe('Old');
  });

  it('commits only the matching typed entity when ids collide', () => {
    act(() => {
      const store = useHomeStore.getState();
      store.ingestRecents(
        'user-1:ws-A',
        [item('same', 'Task', 'task'), item('same', 'Document', 'document')],
        10,
        100,
      );
      store.commitRecentTitle('user-1:ws-A', 'task', 'same', 'Renamed task');
    });

    const entities = useHomeStore.getState().recentEntitiesByScope['user-1:ws-A'];
    expect(entities?.['task:same']?.title).toBe('Renamed task');
    expect(entities?.['document:same']?.title).toBe('Document');
  });

  it('revalidates both list surfaces without clearing confirmed data', async () => {
    const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as never);

    await act(() => useHomeStore.getState().refreshRecents());

    expect(mutateSpy).toHaveBeenCalledTimes(2);
    const matcher = mutateSpy.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher(recentKeys.list(true, 10, 's'))).toBe(true);
  });
});
