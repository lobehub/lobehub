/**
 * @vitest-environment happy-dom
 *
 * Sidebar favorites are a replica list. A star click shows up in the sidebar
 * before the server answers, a refused write puts the list back, and a
 * renamed target rewrites its snapshot only when something changed.
 */
import { randomUUID } from 'node:crypto';

import type { FavoriteItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { favoriteService } from '@/services/favorite';
import { useHomeStore } from '@/store/home';
import { favoriteSelectors } from '@/store/home/selectors';

import { initialFavoriteState } from './initialState';
import { favoriteListResource } from './projection';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const favorite = (targetId: string, overrides: Partial<FavoriteItem> = {}): FavoriteItem => ({
  icon: null,
  id: `fav_${targetId}`,
  path: `/page/${targetId}`,
  targetId,
  title: targetId,
  type: 'page',
  ...overrides,
});

const STORAGE_KEY = favoriteListResource.storageKey({});

const renderSync = () =>
  renderHook(() => useHomeStore((s) => s.useFetchFavorites)(true), { wrapper });

const list = () => favoriteSelectors.favorites(useHomeStore.getState());

describe('favorite slice', () => {
  const scopes = new Set<string>();

  beforeEach(() => {
    const scope = `favorite-user-${randomUUID()}:personal`;
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    useHomeStore.setState({ ...initialFavoriteState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((scope) =>
        favoriteListResource.storage!.remove({ queryKey: STORAGE_KEY, scope }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  const loadWith = async (items: FavoriteItem[]) => {
    vi.spyOn(favoriteService, 'list').mockResolvedValue(items);
    renderSync();
    await waitFor(() =>
      expect(favoriteSelectors.favoriteList(useHomeStore.getState())).toBeDefined(),
    );
  };

  it('shows a new favorite before the server answers, then keeps the saved row', async () => {
    await loadWith([favorite('a')]);
    let resolveAdd!: (item: FavoriteItem) => void;
    const add = vi
      .spyOn(favoriteService, 'add')
      .mockImplementation(() => new Promise((resolve) => (resolveAdd = resolve)));

    let toggled!: Promise<void>;
    act(() => {
      toggled = useHomeStore
        .getState()
        .toggleFavorite({ path: '/page/b', targetId: 'b', title: 'B', type: 'page' });
    });

    expect(list().map((item) => item.targetId)).toEqual(['a', 'b']);

    await waitFor(() => expect(add).toHaveBeenCalled());
    await act(async () => {
      resolveAdd(favorite('b', { title: 'B' }));
      await toggled;
    });
    expect(list()[1]).toEqual(favorite('b', { title: 'B' }));
  });

  it('puts a removed favorite back when the server refuses', async () => {
    await loadWith([favorite('a'), favorite('b')]);
    vi.spyOn(favoriteService, 'removeByTarget').mockRejectedValue(new Error('offline'));

    await act(async () => {
      await expect(
        useHomeStore
          .getState()
          .toggleFavorite({ path: '/page/a', targetId: 'a', title: 'a', type: 'page' }),
      ).rejects.toThrow('offline');
    });

    expect(list().map((item) => item.targetId)).toEqual(['a', 'b']);
  });

  it('reorders right away and sends the new order', async () => {
    await loadWith([favorite('a'), favorite('b'), favorite('c')]);
    const reorder = vi.spyOn(favoriteService, 'reorder').mockResolvedValue();

    await act(() => useHomeStore.getState().reorderFavorites(['fav_c', 'fav_a', 'fav_b']));

    expect(list().map((item) => item.targetId)).toEqual(['c', 'a', 'b']);
    expect(reorder).toHaveBeenCalledWith(['fav_c', 'fav_a', 'fav_b']);
  });

  it('sends overlapping reorders in drag order, so the last drag wins', async () => {
    await loadWith([favorite('a'), favorite('b'), favorite('c')]);
    const sent: string[][] = [];
    const settle: (() => void)[] = [];
    vi.spyOn(favoriteService, 'reorder').mockImplementation(async (ids) => {
      sent.push(ids);
      await new Promise<void>((resolve) => settle.push(resolve));
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = useHomeStore.getState().reorderFavorites(['fav_b', 'fav_a', 'fav_c']);
      second = useHomeStore.getState().reorderFavorites(['fav_c', 'fav_b', 'fav_a']);
    });

    await waitFor(() => expect(sent).toHaveLength(1));
    // The second drag waits for the first request instead of racing it.
    expect(sent).toEqual([['fav_b', 'fav_a', 'fav_c']]);

    await act(async () => {
      settle[0]();
      await first;
    });
    await waitFor(() => expect(sent).toHaveLength(2));
    await act(async () => {
      settle[1]();
      await second;
    });

    expect(sent[1]).toEqual(['fav_c', 'fav_b', 'fav_a']);
    expect(list().map((item) => item.targetId)).toEqual(['c', 'b', 'a']);
  });

  it('leaves a row still being added out of the persisted order', async () => {
    await loadWith([favorite('a'), favorite('b')]);
    const reorder = vi.spyOn(favoriteService, 'reorder').mockResolvedValue();

    await act(() =>
      useHomeStore.getState().reorderFavorites(['fav_b', 'optimistic:page:c', 'fav_a']),
    );

    expect(reorder).toHaveBeenCalledWith(['fav_b', 'fav_a']);
  });

  it('keeps the dragged order across a row whose add is still pending', async () => {
    await loadWith([favorite('a'), favorite('b')]);
    let resolveAdd!: (item: FavoriteItem) => void;
    const add = vi
      .spyOn(favoriteService, 'add')
      .mockImplementation(() => new Promise((resolve) => (resolveAdd = resolve)));
    const reorder = vi.spyOn(favoriteService, 'reorder').mockResolvedValue();

    let added!: Promise<void>;
    let reordered!: Promise<void>;
    act(() => {
      added = useHomeStore
        .getState()
        .addFavorite({ path: '/page/c', targetId: 'c', title: 'c', type: 'page' });
    });
    act(() => {
      reordered = useHomeStore.getState().reorderFavorites(['fav_b', 'optimistic:page:c', 'fav_a']);
    });
    expect(list().map((item) => item.targetId)).toEqual(['b', 'c', 'a']);

    await waitFor(() => expect(add).toHaveBeenCalled());
    // The reorder waits for the add instead of dropping the pending row.
    expect(reorder).not.toHaveBeenCalled();
    await act(async () => {
      resolveAdd(favorite('c'));
      await added;
      await reordered;
    });

    expect(reorder).toHaveBeenCalledWith(['fav_b', 'fav_c', 'fav_a']);
    expect(list().map((item) => item.id)).toEqual(['fav_b', 'fav_c', 'fav_a']);
  });

  it('rewrites a snapshot only when the target changed', async () => {
    await loadWith([favorite('a', { title: 'Old' })]);
    const update = vi.spyOn(favoriteService, 'update').mockResolvedValue();

    await act(() =>
      useHomeStore.getState().syncFavoriteSnapshot('page', 'a', { icon: null, title: 'Old' }),
    );
    expect(update).not.toHaveBeenCalled();

    await act(() => useHomeStore.getState().syncFavoriteSnapshot('page', 'a', { title: 'New' }));
    expect(update).toHaveBeenCalledWith('fav_a', { title: 'New' });
    expect(list()[0].title).toBe('New');
  });

  it('updates the saved row on the server when the list has not loaded here', async () => {
    vi.spyOn(favoriteService, 'list').mockResolvedValue([
      favorite('p1', { title: 'Old', type: 'project' }),
    ]);
    const update = vi.spyOn(favoriteService, 'update').mockResolvedValue();

    await act(() =>
      useHomeStore.getState().syncFavoriteSnapshot('project', 'p1', { icon: null, title: 'New' }),
    );
    expect(update).toHaveBeenCalledWith('fav_p1', { title: 'New' });

    update.mockClear();
    await act(() =>
      useHomeStore.getState().syncFavoriteSnapshot('project', 'p2', { title: 'Other' }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('retries a server-side snapshot update after a brief outage', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(favoriteService, 'list')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([favorite('p1', { title: 'Old', type: 'project' })]);
      const update = vi.spyOn(favoriteService, 'update').mockResolvedValue();

      const sync = useHomeStore.getState().syncFavoriteSnapshot('project', 'p1', { title: 'New' });
      await vi.advanceTimersByTimeAsync(1000);
      await sync;

      expect(update).toHaveBeenCalledWith('fav_p1', { title: 'New' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stores a long page title cut to the favorite limit', async () => {
    await loadWith([]);
    const add = vi
      .spyOn(favoriteService, 'add')
      .mockImplementation(async (params) => favorite(params.targetId, { title: params.title }));
    const longTitle = '📄'.repeat(600);

    await act(() =>
      useHomeStore
        .getState()
        .addFavorite({ path: '/page/long', targetId: 'long', title: longTitle, type: 'page' }),
    );

    const sent = add.mock.calls[0][0].title;
    expect(Array.from(sent)).toHaveLength(512);
    expect(sent.startsWith('📄')).toBe(true);
    expect(list()[0].title).toBe(sent);
  });
});
