/**
 * @vitest-environment happy-dom
 *
 * The user-memory experience list is a `@lobechat/replica` paged resource: the
 * persisted head page paints before the network answers, the response confirms
 * and persists it, "load more" appends through the engine, a query change
 * repaints from its own head page instead of appending to the previous search,
 * and a delete drops the row from the view and the persisted projection.
 */
import { randomUUID } from 'node:crypto';

import { type ExperienceListItem, type ExperienceListResult } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';

import { initialState } from '../../initialState';
import { useUserMemoryStore } from '../../store';
import {
  EXPERIENCE_LIST_KEY,
  type ExperienceListData,
  type ExperienceListParams,
  experienceListResource,
} from './projection';

const BASE_PARAMS: ExperienceListParams = { pageSize: 12 };
const SEARCH_PARAMS: ExperienceListParams = { pageSize: 12, q: 'foo' };
const BASE_KEY = experienceListResource.storageKey(BASE_PARAMS);
const SEARCH_KEY = experienceListResource.storageKey(SEARCH_PARAMS);

const item = (id: string): ExperienceListItem => ({ id, title: id }) as ExperienceListItem;

const ids = (data?: ExperienceListData) => data?.items.map((entry) => entry.id);

const idsOf = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => item(`experience-${i + offset}`));

const listPage = (items: ExperienceListItem[], total: number): ExperienceListResult => ({
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

describe('experienceList replica', () => {
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
    useScope(`experience-user-${randomUUID()}:personal`);
    fetchSpy = vi.spyOn(userMemoryService, 'queryExperiences');
    act(() => useUserMemoryStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [BASE_KEY, SEARCH_KEY].map((queryKey) =>
          experienceListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('reads the list from a single scope entry', () => {
    expect(EXPERIENCE_LIST_KEY).toBe('all');
  });

  it('paints the persisted head page before the network answers', async () => {
    const cached: ExperienceListData = {
      currentPage: 0,
      hasMore: true,
      items: [item('cached-1')],
      pageSize: 12,
      total: 24,
    };
    await experienceListResource.storage!.set(
      { queryKey: BASE_KEY, scope },
      { data: cached, updatedAt: 1 },
    );
    fetchSpy.mockImplementation(pending);

    renderHook(() => useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['cached-1']),
    );
    // The flat mirror paints the persisted rows too.
    expect(useUserMemoryStore.getState().experiences.map((e) => e.id)).toEqual(['cached-1']);
    expect(useUserMemoryStore.getState().experiencesInit).toBe(true);
  });

  it('replaces the head page with the server response and persists it', async () => {
    fetchSpy.mockResolvedValue(listPage([item('a'), item('b')], 24));

    renderHook(() => useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['a', 'b']),
    );
    expect(useUserMemoryStore.getState().experiences.map((e) => e.id)).toEqual(['a', 'b']);
    expect(useUserMemoryStore.getState().experiencesTotal).toBe(24);
    expect(useUserMemoryStore.getState().experiencesHasMore).toBe(true);

    await waitFor(async () => {
      const row = await experienceListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as ExperienceListData)).toEqual(['a', 'b']);
    });
  });

  it('appends the next page with the loaded query params', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(idsOf(12), 24))
      .mockResolvedValueOnce(listPage(idsOf(12, 12), 24));

    const hook = renderHook(
      () => ({
        loadMore: useUserMemoryStore((s) => s.loadMoreExperiences),
        sync: useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12 }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(useUserMemoryStore.getState().experiences).toHaveLength(12));

    await act(async () => {
      hook.result.current.loadMore();
    });

    await waitFor(() => expect(useUserMemoryStore.getState().experiences).toHaveLength(24));
    const list = useUserMemoryStore.getState().experienceListData!;
    expect(list.currentPage).toBe(1);
    expect(list.items[12].id).toBe('experience-12');
    expect(list.hasMore).toBe(false);
    // The replica owns the cursor: page 2 of the loaded query.
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 12 }));
  });

  it('repaints from its own head page when the query changes', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(idsOf(12), 24))
      .mockResolvedValueOnce(listPage(idsOf(12, 12), 24))
      .mockResolvedValueOnce(listPage([item('foo-1')], 1));

    const hook = renderHook(
      (props: { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    await waitFor(() => expect(useUserMemoryStore.getState().experiences).toHaveLength(12));
    act(() => {
      useUserMemoryStore.getState().loadMoreExperiences();
    });
    await waitFor(() => expect(useUserMemoryStore.getState().experiences).toHaveLength(24));

    hook.rerender({ q: 'foo' });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['foo-1']),
    );
    // A different query resets the loaded depth; it never merges into the previous search.
    expect(useUserMemoryStore.getState().experienceListData).toMatchObject({
      currentPage: 0,
      q: 'foo',
      total: 1,
    });
  });

  it('keeps the newest query when a superseded search resolves last', async () => {
    const pendingByQuery = new Map<string, (value: ExperienceListResult) => void>();
    fetchSpy.mockImplementation(
      (params: { q?: string } = {}) =>
        new Promise<ExperienceListResult>((resolve) => pendingByQuery.set(params.q ?? '', resolve)),
    );

    const hook = renderHook(
      (props: { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    hook.rerender({ q: 'foo' });
    await waitFor(() => expect(pendingByQuery.has('foo')).toBe(true));

    await act(async () => {
      pendingByQuery.get('foo')!(listPage([item('foo-1')], 1));
    });
    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['foo-1']),
    );

    // The superseded head request settles late and must not repaint the view.
    await act(async () => {
      pendingByQuery.get('')!(listPage(idsOf(12), 24));
    });

    expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['foo-1']);
  });

  it('drops the painted page set on reset but keeps the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([item('a')], 1));

    renderHook(() => useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['a']),
    );
    await waitFor(async () =>
      expect(
        (await experienceListResource.storage!.get({ queryKey: BASE_KEY, scope }))?.data,
      ).toBeDefined(),
    );

    act(() => useUserMemoryStore.getState().resetExperiencesList({ q: 'gone' }));

    expect(useUserMemoryStore.getState().experienceListData).toBeUndefined();
    expect(useUserMemoryStore.getState().experiences).toEqual([]);
    expect(useUserMemoryStore.getState().experiencesSearchLoading).toBe(true);
    const row = await experienceListResource.storage!.get({ queryKey: BASE_KEY, scope });
    expect(ids(row?.data as ExperienceListData)).toEqual(['a']);
  });

  it('drops a deleted experience from the view and the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([item('a'), item('b')], 2));
    vi.spyOn(memoryCRUDService, 'deleteExperience').mockResolvedValue(undefined as never);

    renderHook(() => useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12 }), {
      wrapper,
    });
    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['a', 'b']),
    );

    await act(async () => {
      await useUserMemoryStore.getState().deleteExperience('a');
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().experienceListData)).toEqual(['b']),
    );
    expect(useUserMemoryStore.getState().experiences.map((e) => e.id)).toEqual(['b']);

    await waitFor(async () => {
      const row = await experienceListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as ExperienceListData)).toEqual(['b']);
    });
  });

  it('does not fetch another page when the head page is the last one', async () => {
    fetchSpy.mockResolvedValue(listPage([item('only')], 1));

    renderHook(() => useUserMemoryStore((s) => s.useFetchExperiences)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() => expect(useUserMemoryStore.getState().experiences).toHaveLength(1));
    expect(useUserMemoryStore.getState().experiencesHasMore).toBe(false);

    act(() => {
      useUserMemoryStore.getState().loadMoreExperiences();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
