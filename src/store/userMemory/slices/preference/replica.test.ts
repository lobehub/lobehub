/**
 * @vitest-environment happy-dom
 *
 * The user-memory preference list is a `@lobechat/replica` paged resource: the
 * persisted head page paints before the network answers, the response confirms
 * and persists it, "load more" appends through the engine, a query change
 * repaints from its own head page instead of appending to the previous search,
 * and a delete drops the row from the view and the persisted projection.
 */
import { randomUUID } from 'node:crypto';

import { type UserMemoryItemSimple } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { LayersEnum } from '@/types/userMemory';

import { initialState } from '../../initialState';
import { useUserMemoryStore } from '../../store';
import {
  PREFERENCE_LIST_KEY,
  type PreferenceListData,
  type PreferenceListParams,
  preferenceListResource,
} from './projection';

const BASE_PARAMS: PreferenceListParams = { pageSize: 12 };
const SEARCH_PARAMS: PreferenceListParams = { pageSize: 12, q: 'foo' };
const SORT_PARAMS: PreferenceListParams = { pageSize: 12, sort: 'scorePriority' };
const BASE_KEY = preferenceListResource.storageKey(BASE_PARAMS);
const SEARCH_KEY = preferenceListResource.storageKey(SEARCH_PARAMS);
const SORT_KEY = preferenceListResource.storageKey(SORT_PARAMS);

/** One raw query-memory row, before the slice flattens it for display. */
const rawItem = (id: string) =>
  ({ memory: { id, title: id }, preference: {} }) as unknown as UserMemoryItemSimple;

const item = (id: string): DisplayPreferenceMemory =>
  ({ id, title: id }) as DisplayPreferenceMemory;

const ids = (data?: PreferenceListData) => data?.items.map((entry) => entry.id);

const rawItemsOf = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => rawItem(`preference-${i + offset}`));

const listPage = (items: UserMemoryItemSimple[], total: number) => ({
  items,
  page: 1,
  pageSize: 12,
  total,
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

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

describe('preferenceList replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`preference-user-${randomUUID()}:personal`);
    fetchSpy = vi.spyOn(userMemoryService, 'queryMemories');
    act(() => useUserMemoryStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [BASE_KEY, SEARCH_KEY, SORT_KEY].map((queryKey) =>
          preferenceListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('reads the list from a single scope entry', () => {
    expect(PREFERENCE_LIST_KEY).toBe('all');
  });

  it('paints the persisted head page before the network answers', async () => {
    const cached: PreferenceListData = {
      currentPage: 0,
      hasMore: true,
      items: [item('cached-1')],
      pageSize: 12,
      total: 24,
    };
    await preferenceListResource.storage!.set(
      { queryKey: BASE_KEY, scope },
      { data: cached, updatedAt: 1 },
    );
    fetchSpy.mockImplementation(pending);

    renderHook(() => useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['cached-1']),
    );
    // The flat mirror paints the persisted rows too.
    expect(useUserMemoryStore.getState().preferences.map((p) => p.id)).toEqual(['cached-1']);
    expect(useUserMemoryStore.getState().preferencesInit).toBe(true);
  });

  it('replaces the head page with the server response and persists it', async () => {
    fetchSpy.mockResolvedValue(listPage([rawItem('a'), rawItem('b')], 24));

    renderHook(() => useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['a', 'b']),
    );
    expect(useUserMemoryStore.getState().preferences.map((p) => p.id)).toEqual(['a', 'b']);
    expect(useUserMemoryStore.getState().preferencesTotal).toBe(24);
    expect(useUserMemoryStore.getState().preferencesHasMore).toBe(true);
    // The nested `{ memory, preference }` row is flattened for display, and the
    // fetch is scoped to the preference layer.
    expect(useUserMemoryStore.getState().preferences[0]).toMatchObject({ id: 'a', title: 'a' });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ layer: LayersEnum.Preference }),
    );

    await waitFor(async () => {
      const row = await preferenceListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as PreferenceListData)).toEqual(['a', 'b']);
    });
  });

  it('appends the next page with the loaded query params', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(rawItemsOf(12), 24))
      .mockResolvedValueOnce(listPage(rawItemsOf(12, 12), 24));

    const hook = renderHook(
      () => ({
        loadMore: useUserMemoryStore((s) => s.loadMorePreferences),
        sync: useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12 }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(useUserMemoryStore.getState().preferences).toHaveLength(12));

    await act(async () => {
      hook.result.current.loadMore();
    });

    await waitFor(() => expect(useUserMemoryStore.getState().preferences).toHaveLength(24));
    const list = useUserMemoryStore.getState().preferenceListData!;
    expect(list.currentPage).toBe(1);
    expect(list.items[12].id).toBe('preference-12');
    expect(list.hasMore).toBe(false);
    // The replica owns the cursor: page 2 of the loaded query.
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 12 }));
  });

  it('repaints from its own head page when the query changes', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(rawItemsOf(12), 24))
      .mockResolvedValueOnce(listPage(rawItemsOf(12, 12), 24))
      .mockResolvedValueOnce(listPage([rawItem('foo-1')], 1));

    const hook = renderHook(
      (props: { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    await waitFor(() => expect(useUserMemoryStore.getState().preferences).toHaveLength(12));
    act(() => {
      useUserMemoryStore.getState().loadMorePreferences();
    });
    await waitFor(() => expect(useUserMemoryStore.getState().preferences).toHaveLength(24));

    hook.rerender({ q: 'foo' });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['foo-1']),
    );
    // A different query resets the loaded depth; it never merges into the previous search.
    expect(useUserMemoryStore.getState().preferenceListData).toMatchObject({
      currentPage: 0,
      q: 'foo',
      total: 1,
    });
  });

  it('treats a sort change as a new page set', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage([rawItem('captured-1')], 2))
      .mockResolvedValueOnce(listPage([rawItem('priority-1')], 2));

    const hook = renderHook(
      (props: { sort?: PreferenceListParams['sort'] }) =>
        useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12, sort: props.sort }),
      { initialProps: {} as { sort?: PreferenceListParams['sort'] }, wrapper },
    );

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['captured-1']),
    );

    hook.rerender({ sort: 'scorePriority' });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['priority-1']),
    );
    expect(useUserMemoryStore.getState().preferenceListData).toMatchObject({
      currentPage: 0,
      sort: 'scorePriority',
    });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'scorePriority', layer: LayersEnum.Preference }),
    );
  });

  it('keeps the newest query when a superseded search resolves last', async () => {
    const pendingByQuery = new Map<string, (value: ReturnType<typeof listPage>) => void>();
    fetchSpy.mockImplementation(
      (params: { q?: string } = {}) =>
        new Promise((resolve) => pendingByQuery.set(params.q ?? '', resolve)),
    );

    const hook = renderHook(
      (props: { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    hook.rerender({ q: 'foo' });
    await waitFor(() => expect(pendingByQuery.has('foo')).toBe(true));

    await act(async () => {
      pendingByQuery.get('foo')!(listPage([rawItem('foo-1')], 1));
    });
    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['foo-1']),
    );

    // The superseded head request settles late and must not repaint the view.
    await act(async () => {
      pendingByQuery.get('')!(listPage(rawItemsOf(12), 24));
    });

    expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['foo-1']);
  });

  it('drops the painted page set on reset but keeps the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([rawItem('a')], 1));

    renderHook(() => useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['a']),
    );
    await waitFor(async () =>
      expect(
        (await preferenceListResource.storage!.get({ queryKey: BASE_KEY, scope }))?.data,
      ).toBeDefined(),
    );

    act(() => useUserMemoryStore.getState().resetPreferencesList({ q: 'gone' }));

    expect(useUserMemoryStore.getState().preferenceListData).toBeUndefined();
    expect(useUserMemoryStore.getState().preferences).toEqual([]);
    expect(useUserMemoryStore.getState().preferencesSearchLoading).toBe(true);
    const row = await preferenceListResource.storage!.get({ queryKey: BASE_KEY, scope });
    expect(ids(row?.data as PreferenceListData)).toEqual(['a']);
  });

  it('drops a deleted preference from the view and the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([rawItem('a'), rawItem('b')], 2));
    vi.spyOn(memoryCRUDService, 'deletePreference').mockResolvedValue(undefined as never);

    renderHook(() => useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12 }), {
      wrapper,
    });
    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['a', 'b']),
    );

    await act(async () => {
      await useUserMemoryStore.getState().deletePreference('a');
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().preferenceListData)).toEqual(['b']),
    );
    expect(useUserMemoryStore.getState().preferences.map((p) => p.id)).toEqual(['b']);

    await waitFor(async () => {
      const row = await preferenceListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as PreferenceListData)).toEqual(['b']);
    });
  });

  it('does not fetch another page when the head page is the last one', async () => {
    fetchSpy.mockResolvedValue(listPage([rawItem('only')], 1));

    renderHook(() => useUserMemoryStore((s) => s.useFetchPreferences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() => expect(useUserMemoryStore.getState().preferences).toHaveLength(1));
    expect(useUserMemoryStore.getState().preferencesHasMore).toBe(false);

    act(() => {
      useUserMemoryStore.getState().loadMorePreferences();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
