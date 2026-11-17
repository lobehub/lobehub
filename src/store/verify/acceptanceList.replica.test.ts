/**
 * @vitest-environment happy-dom
 *
 * The acceptance list reads (`acceptanceListMap`, the panel's paged feed in
 * `acceptancePageMap`) and each acceptance's discussion (`acceptanceCommentMap`)
 * are replicas persisted to IndexedDB: a reload paints the last rows before the
 * network answers, then the server's answer replaces them.
 */
import { randomUUID } from 'node:crypto';

import type { AcceptanceCommentList } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAcceptanceList, useAcceptanceListInfinite } from '@/features/Acceptance/hooks';
import { useAcceptanceCommentList } from '@/features/Acceptance/Viewer/Comments/useAcceptanceCommentList';
import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { acceptanceCommentService } from '@/services/acceptanceComment';
import type { AcceptanceListItem } from '@/services/verify';
import { verifyService } from '@/services/verify';

import { useVerifyStore } from './index';
import { initialState } from './initialState';
import {
  acceptanceCommentResource,
  acceptanceListKey,
  type AcceptanceListParams,
  acceptanceListResource,
  type AcceptancePageData,
  acceptancePageKey,
  type AcceptancePageParams,
  acceptancePageResource,
} from './projection';

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

const row = (id: string, title = id) =>
  ({ id, subject: { title }, subjectId: `subject-${id}` }) as unknown as AcceptanceListItem;

const pageData = (items: AcceptanceListItem[]): AcceptancePageData => ({
  currentPage: 0,
  hasMore: false,
  items,
  nextCursor: null,
});

const comments = (ids: string[]): AcceptanceCommentList =>
  ({
    canApprove: false,
    canComment: true,
    items: ids.map((id) => ({ content: id, id })),
  }) as unknown as AcceptanceCommentList;

/** A fetch the test settles by hand: the first frame can only come from storage. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const FEED: AcceptancePageParams = { filter: 'all' };
const ALL: AcceptanceListParams = { filter: 'all' };

describe('acceptance list and comment replicas', () => {
  let scope = '';

  const pageStorage = acceptancePageResource.storage!;
  const listStorage = acceptanceListResource.storage!;
  const commentStorage = acceptanceCommentResource.storage!;

  const persistPage = (params: AcceptancePageParams, data: AcceptancePageData, at = scope) =>
    pageStorage.set(
      { queryKey: acceptancePageResource.storageKey(params), scope: at },
      { data, updatedAt: 1 },
    );
  const persistList = (params: AcceptanceListParams, data: AcceptanceListItem[], at = scope) =>
    listStorage.set(
      { queryKey: acceptanceListResource.storageKey(params), scope: at },
      { data, updatedAt: 1 },
    );
  const storedPage = async (params: AcceptancePageParams) =>
    (await pageStorage.get({ queryKey: acceptancePageResource.storageKey(params), scope }))?.data;
  const storedList = async (params: AcceptanceListParams) =>
    (await listStorage.get({ queryKey: acceptanceListResource.storageKey(params), scope }))?.data;

  beforeEach(() => {
    scope = `acceptance-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useVerifyStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    // Each test runs in a fresh random scope; only the index rows are shared names.
    for (const storage of [pageStorage, listStorage, commentStorage]) {
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    }
    vi.restoreAllMocks();
  });

  it('paints the persisted feed head before the network answers, then refreshes it', async () => {
    await persistPage(FEED, pageData([row('a1', 'Stored')]));
    const network = deferred<{ items: AcceptanceListItem[]; nextCursor: string | null }>();
    vi.spyOn(verifyService, 'listAcceptancePage').mockReturnValue(network.promise as never);

    const { result } = renderHook(() => useAcceptanceListInfinite('all'), { wrapper });

    // The list panel has its last rows on the first painted frame after reload.
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['a1']));
    expect(result.current.isLoadingInitial).toBe(false);

    await act(async () => network.resolve({ items: [row('a2'), row('a1')], nextCursor: null }));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['a2', 'a1']));
  });

  it('reads a restored empty feed as loading until the server confirms it', async () => {
    await persistPage(FEED, pageData([]));
    const network = deferred<{ items: AcceptanceListItem[]; nextCursor: string | null }>();
    vi.spyOn(verifyService, 'listAcceptancePage').mockReturnValue(network.promise as never);

    const { result } = renderHook(() => useAcceptanceListInfinite('all'), { wrapper });

    await waitFor(() =>
      expect(useVerifyStore.getState().acceptancePageMap['all|||']).toBeDefined(),
    );
    // An empty snapshot from the last session is not "no acceptances" yet.
    expect(result.current.isLoadingInitial).toBe(true);

    await act(async () => network.resolve({ items: [], nextCursor: null }));
    await waitFor(() => expect(result.current.isLoadingInitial).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it('keeps the rows on screen when a background refresh fails', async () => {
    await persistPage(FEED, pageData([row('a1')]));
    const network = deferred<never>();
    vi.spyOn(verifyService, 'listAcceptancePage').mockReturnValue(network.promise as never);

    const { result } = renderHook(() => useAcceptanceListInfinite('all'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      network.reject(new Error('offline'));
      await network.promise.catch(() => {});
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.items.map((item) => item.id)).toEqual(['a1']);
    expect(result.current.error).toBeUndefined();
  });

  it('drops a deleted acceptance from every list and from storage', async () => {
    await persistPage(FEED, pageData([row('a1'), row('a2')]));
    await persistList(ALL, [row('a1'), row('a2')]);
    vi.spyOn(verifyService, 'listAcceptancePage').mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(verifyService, 'listAcceptances').mockReturnValue(new Promise(() => {}) as never);

    const feed = renderHook(() => useAcceptanceListInfinite('all'), { wrapper });
    const list = renderHook(() => useAcceptanceList(true, ALL), { wrapper });
    await waitFor(() => expect(feed.result.current.items).toHaveLength(2));
    await waitFor(() => expect(list.result.current.data).toHaveLength(2));

    act(() => useVerifyStore.getState().removeAcceptancesFromLists(['a1']));

    expect(feed.result.current.items.map((item) => item.id)).toEqual(['a2']);
    expect(list.result.current.data?.map((item) => item.id)).toEqual(['a2']);
    // A reload must not paint the deleted row back from IndexedDB.
    await waitFor(async () =>
      expect((await storedPage(FEED))?.items.map((item) => item.id)).toEqual(['a2']),
    );
    await waitFor(async () =>
      expect((await storedList(ALL))?.map((item) => item.id)).toEqual(['a2']),
    );
  });

  it('paints the persisted flat list and gates a restored empty one behind the server', async () => {
    await persistList(ALL, [row('a1')]);
    await persistList({ filter: 'all', projectId: 'p1' }, []);
    const network = deferred<AcceptanceListItem[]>();
    vi.spyOn(verifyService, 'listAcceptances').mockReturnValue(network.promise);

    const filled = renderHook(() => useAcceptanceList(true, ALL), { wrapper });
    const empty = renderHook(() => useAcceptanceList(true, { filter: 'all', projectId: 'p1' }), {
      wrapper,
    });

    await waitFor(() => expect(filled.result.current.data?.map((item) => item.id)).toEqual(['a1']));
    await waitFor(() =>
      expect(
        useVerifyStore.getState().acceptanceListMap[
          acceptanceListKey({ filter: 'all', projectId: 'p1' })
        ],
      ).toEqual([]),
    );
    // Onboarding / empty states read `data`: a restored empty list must not show them.
    expect(empty.result.current.data).toBeUndefined();
    expect(empty.result.current.isLoading).toBe(true);

    await act(async () => network.resolve([]));
    await waitFor(() => expect(empty.result.current.data).toEqual([]));
    expect(empty.result.current.isLoading).toBe(false);
  });

  it('keeps search results in memory only', async () => {
    vi.spyOn(verifyService, 'listAcceptances').mockResolvedValue([row('hit')]);
    const search: AcceptanceListParams = { filter: 'all', q: 'needle' };

    const { result } = renderHook(() => useAcceptanceList(true, search), { wrapper });
    await waitFor(() => expect(result.current.data?.map((item) => item.id)).toEqual(['hit']));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await storedList(search)).toBeUndefined();
  });

  it('sends one request for callers that mount the same list together', async () => {
    const listAcceptances = vi.spyOn(verifyService, 'listAcceptances').mockResolvedValue([]);

    // The workspace shell, then the list panel's empty-state probe a moment later.
    const { rerender } = renderHook(
      ({ late }: { late: boolean }) => {
        useAcceptanceList(true, ALL);
        useAcceptanceList(true, ALL);
        useAcceptanceList(late, ALL);
      },
      { initialProps: { late: false }, wrapper },
    );
    await waitFor(() => expect(listAcceptances).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    rerender({ late: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listAcceptances).toHaveBeenCalledOnce();
  });

  it('never shows the previous identity rows after a scope switch', async () => {
    const other = `acceptance-other-${randomUUID()}:personal`;
    await persistPage(FEED, pageData([row('mine')]));
    await persistPage(FEED, pageData([row('theirs')]), other);
    vi.spyOn(verifyService, 'listAcceptancePage').mockReturnValue(new Promise(() => {}) as never);

    const { result, rerender } = renderHook(() => useAcceptanceListInfinite('all'), { wrapper });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['mine']));

    scope = other;
    rerender();
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['theirs']));
    expect(result.current.items.some((item) => item.id === 'mine')).toBe(false);

    await pageStorage.remove({ queryKey: REPLICA_INDEX_KEY, scope: other });
  });

  it('keys every list narrowing apart', () => {
    expect(acceptancePageKey({ filter: 'all', projectId: 'p1' })).not.toBe(
      acceptancePageKey({ filter: 'all', projectId: 'p2' }),
    );
    expect(acceptancePageKey({ filter: 'all', projectId: null })).not.toBe(
      acceptancePageKey({ filter: 'all' }),
    );
    expect(acceptancePageKey({ filter: 'all', scope: 'participated' })).not.toBe(
      acceptancePageKey({ filter: 'all' }),
    );
    expect(acceptanceListKey({ filter: 'all', limit: 200 })).not.toBe(
      acceptanceListKey({ filter: 'all' }),
    );
    expect(acceptanceListKey({ filter: 'all', q: 'x' })).not.toBe(
      acceptanceListKey({ filter: 'all' }),
    );
  });

  describe('discussion', () => {
    const persistComments = (acceptanceId: string, data: AcceptanceCommentList) =>
      commentStorage.set(
        { queryKey: acceptanceCommentResource.storageKey(acceptanceId), scope },
        { data, updatedAt: 1 },
      );

    it('paints the persisted discussion before the network answers, then refreshes it', async () => {
      await persistComments('acc-1', comments(['c1']));
      const network = deferred<AcceptanceCommentList>();
      vi.spyOn(acceptanceCommentService, 'list').mockReturnValue(network.promise);

      const { result } = renderHook(() => useAcceptanceCommentList('acc-1'), { wrapper });

      await waitFor(() =>
        expect(result.current.data?.items.map((item) => item.id)).toEqual(['c1']),
      );
      expect(result.current.isLoading).toBe(false);

      await act(async () => network.resolve(comments(['c1', 'c2'])));
      await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
    });

    it('reads a restored empty discussion as loading until the server confirms it', async () => {
      await persistComments('acc-2', comments([]));
      const network = deferred<AcceptanceCommentList>();
      vi.spyOn(acceptanceCommentService, 'list').mockReturnValue(network.promise);

      const { result } = renderHook(() => useAcceptanceCommentList('acc-2'), { wrapper });

      await waitFor(() =>
        expect(useVerifyStore.getState().acceptanceCommentMap['acc-2']).toBeDefined(),
      );
      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);

      await act(async () => network.resolve(comments([])));
      await waitFor(() => expect(result.current.data?.items).toEqual([]));
    });

    it('rolls a failed optimistic change back to the confirmed discussion', async () => {
      vi.spyOn(acceptanceCommentService, 'list').mockResolvedValue(comments(['c1']));
      const { result } = renderHook(() => useAcceptanceCommentList('acc-3'), { wrapper });
      await waitFor(() => expect(result.current.data?.items).toHaveLength(1));

      await act(async () => {
        await useVerifyStore
          .getState()
          .optimisticAcceptanceComments(
            'acc-3',
            (current) => ({ ...current, items: [] }),
            () => Promise.reject(new Error('denied')),
          )
          .catch(() => {});
      });

      expect(result.current.data?.items.map((item) => item.id)).toEqual(['c1']);
    });
  });
});
