/**
 * @vitest-environment happy-dom
 */
import { FAVORITE_LIMIT } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FAVORITE_SNAPSHOT_SYNC_ATTEMPTS,
  FAVORITE_SNAPSHOT_SYNC_DELAY,
  type FavoriteTarget,
  useFavoriteToggle,
} from './useFavoriteToggle';

const store = vi.hoisted(() => ({
  favoriteId: undefined as string | undefined,
  listLoaded: true,
  listSize: 0,
  storedTitle: 'Stored',
  syncFavoriteSnapshot: vi.fn(),
  toggleFavorite: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ toast: { error: store.toastError } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./useFetchFavorites', () => ({ useFetchFavorites: () => ({}) }));
vi.mock('@/store/home/selectors', () => ({
  favoriteSelectors: {
    favoriteList: () => (store.listLoaded ? Array.from({ length: store.listSize }) : undefined),
    getFavorite: () => () =>
      store.favoriteId
        ? { icon: null, id: store.favoriteId, path: '/page/docs_a', title: store.storedTitle }
        : undefined,
  },
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (s: unknown) => unknown) =>
    selector({
      syncFavoriteSnapshot: store.syncFavoriteSnapshot,
      toggleFavorite: store.toggleFavorite,
    }),
}));

const target = (title: string): FavoriteTarget => ({
  path: '/page/docs_a',
  targetId: 'docs_a',
  title,
  type: 'page',
});

describe('useFavoriteToggle snapshot sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.favoriteId = 'fav_a';
    store.storedTitle = 'Stored';
    store.listLoaded = true;
    store.toggleFavorite.mockReset().mockResolvedValue(undefined);
    store.syncFavoriteSnapshot.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a title typed character by character once it settles', () => {
    const { rerender } = renderHook(({ title }) => useFavoriteToggle(target(title)), {
      initialProps: { title: 'S' },
    });
    for (const title of ['Sp', 'Spe', 'Spec']) {
      act(() => vi.advanceTimersByTime(100));
      rerender({ title });
    }

    act(() => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY));

    expect(store.syncFavoriteSnapshot).toHaveBeenCalledTimes(1);
    expect(store.syncFavoriteSnapshot).toHaveBeenLastCalledWith(
      'page',
      'docs_a',
      expect.objectContaining({ title: 'Spec' }),
    );
  });

  it('replays a rename made while the add was pending once the add is confirmed', () => {
    store.favoriteId = 'optimistic:page:docs_a';
    const { rerender } = renderHook(({ title }) => useFavoriteToggle(target(title)), {
      initialProps: { title: 'Renamed' },
    });
    act(() => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY));
    store.syncFavoriteSnapshot.mockClear();

    // The confirmed row arrives with the snapshot sent at add time.
    store.favoriteId = 'fav_a';
    rerender({ title: 'Renamed' });
    act(() => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY));

    expect(store.syncFavoriteSnapshot).toHaveBeenCalledWith(
      'page',
      'docs_a',
      expect.objectContaining({ title: 'Renamed' }),
    );
  });

  it('retries a write that failed and was rolled back', async () => {
    store.syncFavoriteSnapshot.mockRejectedValueOnce(new Error('offline'));
    const { rerender } = renderHook(({ title }) => useFavoriteToggle(target(title)), {
      initialProps: { title: 'Spec' },
    });
    await act(async () => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY));

    // The optimistic title, then the rollback to the stored one.
    store.storedTitle = 'Spec';
    rerender({ title: 'Spec' });
    store.storedTitle = 'Stored';
    rerender({ title: 'Spec' });
    await act(async () => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY));

    expect(store.syncFavoriteSnapshot).toHaveBeenCalledTimes(2);
  });

  it('stops retrying a snapshot that keeps failing', async () => {
    store.syncFavoriteSnapshot.mockRejectedValue(new Error('offline'));
    const { rerender } = renderHook(({ title }) => useFavoriteToggle(target(title)), {
      initialProps: { title: 'Spec' },
    });

    for (let attempt = 0; attempt < FAVORITE_SNAPSHOT_SYNC_ATTEMPTS + 2; attempt++) {
      await act(async () => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY));
      store.storedTitle = attempt % 2 ? 'Stored' : 'Spec';
      rerender({ title: 'Spec' });
    }

    expect(store.syncFavoriteSnapshot).toHaveBeenCalledTimes(FAVORITE_SNAPSHOT_SYNC_ATTEMPTS);
  });

  it('does not write a placeholder title over a saved favorite', () => {
    renderHook(() => useFavoriteToggle({ ...target('New Topic'), snapshotReady: false }));

    act(() => vi.advanceTimersByTime(FAVORITE_SNAPSHOT_SYNC_DELAY * 2));

    expect(store.syncFavoriteSnapshot).not.toHaveBeenCalled();
  });
});

describe('useFavoriteToggle before the list loads', () => {
  it('does not toggle while it cannot tell whether the target is favorited', async () => {
    store.listLoaded = false;
    store.favoriteId = undefined;
    store.toggleFavorite.mockReset().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFavoriteToggle(target('Spec')));

    expect(result.current.isReady).toBe(false);
    await act(() => result.current.toggle());

    expect(store.toggleFavorite).not.toHaveBeenCalled();
  });
});

describe('useFavoriteToggle adding', () => {
  beforeEach(() => {
    store.favoriteId = undefined;
    store.listLoaded = true;
    store.listSize = 0;
    store.toggleFavorite.mockReset().mockResolvedValue(undefined);
    store.toastError.mockReset();
  });

  it("waits for the target's own title before adding it", async () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useFavoriteToggle({ ...target('New Topic'), snapshotReady: ready }),
      { initialProps: { ready: false } },
    );

    expect(result.current.isReady).toBe(false);
    await act(() => result.current.toggle());
    expect(store.toggleFavorite).not.toHaveBeenCalled();

    rerender({ ready: true });
    await act(() => result.current.toggle());
    expect(store.toggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('still removes a favorite whose target has not loaded', () => {
    store.favoriteId = 'fav_a';
    const { result } = renderHook(() =>
      useFavoriteToggle({ ...target('New Topic'), snapshotReady: false }),
    );

    expect(result.current.isReady).toBe(true);
  });

  it('explains a full sidebar instead of sending an add that must fail', async () => {
    store.listSize = FAVORITE_LIMIT;
    const { result } = renderHook(() => useFavoriteToggle(target('Spec')));

    await act(() => result.current.toggle());

    expect(store.toggleFavorite).not.toHaveBeenCalled();
    expect(store.toastError).toHaveBeenCalledWith('favorite.limitReached');
  });
});
