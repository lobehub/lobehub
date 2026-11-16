/**
 * @vitest-environment happy-dom
 *
 * The unresolved brief feed is a replica: the inbox paints the persisted rows
 * on the first frame, a mutation shows at once and rolls back when the server
 * rejects, and the view is cleared when the identity scope changes.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { briefService } from '@/services/brief';
import { useBriefStore } from '@/store/brief';
import type { BriefItem } from '@/store/brief/types';

import { initialBriefListState } from './initialState';
import { briefListResource, briefNewsResource, type NewsDay } from './projection';
import { briefListSelectors, briefNewsSelectors } from './selectors';

const LIST_PARAMS = {} as Record<string, never>;
/** The persisted row of the feed under test (one entry, keyed `unresolved`). */
const STORAGE_KEY = { queryKey: briefListResource.storageKey(LIST_PARAMS) };
const DAY = '2026-07-31';
/** The persisted row of the digest of `DAY`. */
const NEWS_STORAGE_KEY = { queryKey: briefNewsResource.storageKey({ day: DAY }) };

const createBrief = (id: string): BriefItem => ({
  actions: null,
  agent: null,
  agentId: null,
  artifacts: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  cronJobId: null,
  id,
  priority: null,
  readAt: null,
  resolvedAction: null,
  resolvedAt: null,
  resolvedComment: null,
  summary: `${id} summary`,
  taskId: null,
  title: `${id} title`,
  topicId: null,
  type: 'result',
  userId: 'user-1',
});

const deferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
};

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

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

/** The digest of `DAY` as the inbox reads it. */
const newsDay = () => briefNewsSelectors.newsDay(DAY)(useBriefStore.getState());
const newsDayOf = (news: BriefItem[], hasEarlier = false): NewsDay => ({
  day: DAY,
  hasEarlier,
  news,
});
const useNewsDay = () => useBriefStore((s) => s.useFetchNewsByDay)(true, DAY);

/** The feed as the inbox reads it. */
const feed = () => briefListSelectors.briefs(useBriefStore.getState());

/** Drive the real sync path and wait until the head page has landed. */
const load = async (briefs: BriefItem[]) => {
  vi.spyOn(briefService, 'listUnresolved').mockResolvedValue({ data: briefs } as never);
  renderHook(() => useBriefStore((s) => s.useFetchBriefs)(true), { wrapper });
  await waitFor(() => expect(feed()).toBeDefined());
  return briefs;
};

beforeEach(() => {
  useScope(`brief-user-${randomUUID()}:personal`);
  act(() => useBriefStore.setState({ ...initialBriefListState }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('brief list replica', () => {
  it('paints the persisted feed before the network answers', async () => {
    await briefListResource.storage!.set(
      { ...STORAGE_KEY, scope },
      { data: [createBrief('cached')], updatedAt: 1 },
    );
    vi.spyOn(briefService, 'listUnresolved').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useBriefStore((s) => s.useFetchBriefs)(true), { wrapper });

    await waitFor(() => expect(feed().map((brief) => brief.id)).toEqual(['cached']));
    expect(briefListSelectors.isBriefsInit(useBriefStore.getState())).toBe(true);
    expect(result.current.isValidating).toBe(true);
  });

  it('does not fetch while logged out', () => {
    const listUnresolved = vi.spyOn(briefService, 'listUnresolved');
    renderHook(() => useBriefStore((s) => s.useFetchBriefs)(false), { wrapper });
    expect(listUnresolved).not.toHaveBeenCalled();
  });

  it('marks a brief read optimistically and rolls back when the server rejects', async () => {
    await load([createBrief('b1')]);
    const request = deferred<void>();
    vi.spyOn(briefService, 'markRead').mockReturnValue(request.promise as never);

    const pending = useBriefStore.getState().markBriefRead('b1');
    expect(feed()[0].readAt).toBeTruthy();

    request.reject(new Error('failed'));
    await expect(pending).rejects.toThrow('failed');
    expect(feed()[0].readAt).toBeNull();
  });

  it('writes a confirmed resolve through to the persisted row', async () => {
    await load([createBrief('b1')]);
    vi.spyOn(briefService, 'resolve').mockResolvedValue(undefined as never);

    await act(() => useBriefStore.getState().resolveBrief('b1', 'approve'));

    expect(feed()[0]).toMatchObject({ resolvedAction: 'approve' });
    expect(feed()[0].resolvedAt).toBeTruthy();

    await waitFor(async () => {
      const row = await briefListResource.storage!.get({ ...STORAGE_KEY, scope });
      expect(row?.data[0]).toMatchObject({ resolvedAction: 'approve' });
    });
  });

  it('refreshes the day digest when a news brief is resolved from the feed', async () => {
    await load([createBrief('b1')]);
    vi.spyOn(briefService, 'resolve').mockResolvedValue(undefined as never);
    const listNewsByDay = vi
      .spyOn(briefService, 'listNewsByDay')
      .mockResolvedValue({ data: [createBrief('b1')], hasEarlier: false } as never);
    renderHook(() => useBriefStore((s) => s.useFetchNewsByDay)(true, DAY), { wrapper });
    await waitFor(() => expect(newsDay()).toBeDefined());
    expect(listNewsByDay).toHaveBeenCalledTimes(1);
    listNewsByDay.mockImplementation(() => new Promise(() => {}));

    await act(() => useBriefStore.getState().resolveBrief('b1', 'approve'));

    // The answer lands on the digest at once, then the day re-reads.
    expect(newsDay()?.news[0]).toMatchObject({ resolvedAction: 'approve' });
    await waitFor(() => expect(listNewsByDay).toHaveBeenCalledTimes(2));
  });

  it('drops the briefs resolved as read from the feed', async () => {
    await load([createBrief('b1'), createBrief('b2')]);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({ data: ['b1'] } as never);

    await act(() => useBriefStore.getState().resolveBriefsAsRead(['b1']));

    expect(feed().map((brief) => brief.id)).toEqual(['b2']);
  });

  it('removes a deleted brief and restores it when the server rejects', async () => {
    await load([createBrief('b1'), createBrief('b2')]);
    const request = deferred<void>();
    vi.spyOn(briefService, 'delete').mockReturnValue(request.promise as never);

    const pending = useBriefStore.getState().deleteBrief('b1');
    expect(feed().map((brief) => brief.id)).toEqual(['b2']);

    request.reject(new Error('failed'));
    await expect(pending).rejects.toThrow('failed');
    expect(feed().map((brief) => brief.id)).toEqual(['b1', 'b2']);
  });

  it('clears the previous scope’s feed on a scope switch, before any answer lands', async () => {
    vi.spyOn(briefService, 'listUnresolved').mockResolvedValue({
      data: [createBrief('b1'), createBrief('b2')],
    } as never);
    const { rerender } = renderHook(() => useBriefStore((s) => s.useFetchBriefs)(true), {
      wrapper,
    });
    await waitFor(() => expect(feed()).toBeDefined());
    expect(feed().length).toBeGreaterThan(0);

    // A different identity: the previous scope's rows are unreachable here, so
    // they must leave the view even while the new scope's fetch is in flight.
    useScope(`brief-user-${randomUUID()}:personal`);
    vi.spyOn(briefService, 'listUnresolved').mockImplementation(() => new Promise(() => {}));
    rerender();

    await waitFor(() => expect(briefListSelectors.hasBriefs(useBriefStore.getState())).toBe(false));
  });
});

describe('brief news replica', () => {
  it('paints the persisted digest before the network answers, then adopts the server', async () => {
    await briefNewsResource.storage!.set(
      { ...NEWS_STORAGE_KEY, scope },
      { data: newsDayOf([createBrief('cached')]), updatedAt: 1 },
    );
    const request = deferred<{ data: BriefItem[]; hasEarlier: boolean }>();
    vi.spyOn(briefService, 'listNewsByDay').mockReturnValue(request.promise as never);

    const { result } = renderHook(useNewsDay, { wrapper });

    await waitFor(() => expect(newsDay()?.news.map((brief) => brief.id)).toEqual(['cached']));
    expect(result.current.isValidating).toBe(true);
    // Restored, not confirmed: an empty restored day must not read as "nothing today".
    expect(briefNewsSelectors.isNewsDayConfirmed(DAY)(useBriefStore.getState())).toBe(false);

    await act(async () => request.resolve({ data: [createBrief('fresh')], hasEarlier: true }));

    await waitFor(() => expect(newsDay()?.news.map((brief) => brief.id)).toEqual(['fresh']));
    expect(newsDay()?.hasEarlier).toBe(true);
    expect(briefNewsSelectors.isNewsDayConfirmed(DAY)(useBriefStore.getState())).toBe(true);
  });

  it('queries the viewer’s local day as a [start, end) range', async () => {
    const listNewsByDay = vi
      .spyOn(briefService, 'listNewsByDay')
      .mockResolvedValue({ data: [], hasEarlier: false } as never);

    renderHook(useNewsDay, { wrapper });

    await waitFor(() => expect(newsDay()).toBeDefined());
    const [range] = listNewsByDay.mock.calls[0];
    expect(range.startAt.getTime()).toBe(new Date(2026, 6, 31).getTime());
    expect(range.endAt.getTime()).toBe(new Date(2026, 7, 1).getTime());
  });

  it('keeps an empty restored day unconfirmed until the server answers', async () => {
    await briefNewsResource.storage!.set(
      { ...NEWS_STORAGE_KEY, scope },
      { data: newsDayOf([]), updatedAt: 1 },
    );
    vi.spyOn(briefService, 'listNewsByDay').mockImplementation(() => new Promise(() => {}));

    renderHook(useNewsDay, { wrapper });

    await waitFor(() => expect(newsDay()?.news).toEqual([]));
    expect(briefNewsSelectors.isNewsDayConfirmed(DAY)(useBriefStore.getState())).toBe(false);
  });

  it('collapses several readers of the same day into one request', async () => {
    const listNewsByDay = vi
      .spyOn(briefService, 'listNewsByDay')
      .mockResolvedValue({ data: [createBrief('b1')], hasEarlier: false } as never);

    // One app-wide SWR cache, as in the product.
    const cache = new Map();
    const sharedWrapper = ({ children }: PropsWithChildren) =>
      createElement(
        SWRConfig,
        { value: { dedupingInterval: 0, provider: () => cache } },
        createElement(MutateBridge),
        children,
      );

    // Rail + main inbox mounted together, then one more Home surface right after.
    renderHook(
      () => {
        useNewsDay();
        useNewsDay();
      },
      { wrapper: sharedWrapper },
    );
    await waitFor(() => expect(newsDay()).toBeDefined());
    renderHook(useNewsDay, { wrapper: sharedWrapper });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await waitFor(() => expect(newsDay()).toBeDefined());
    expect(listNewsByDay).toHaveBeenCalledTimes(1);
  });

  it('keeps the last digest when a background refresh fails', async () => {
    const listNewsByDay = vi
      .spyOn(briefService, 'listNewsByDay')
      .mockResolvedValue({ data: [createBrief('b1')], hasEarlier: false } as never);
    const { result } = renderHook(useNewsDay, { wrapper });
    await waitFor(() => expect(newsDay()).toBeDefined());

    listNewsByDay.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await result.current.revalidate().catch(() => {});
    });

    expect(newsDay()?.news.map((brief) => brief.id)).toEqual(['b1']);
  });

  it('marks resolved-as-read briefs on the digest and its persisted row', async () => {
    await load([createBrief('b1'), createBrief('b2')]);
    vi.spyOn(briefService, 'listNewsByDay').mockResolvedValue({
      data: [createBrief('b1'), createBrief('b2')],
      hasEarlier: false,
    } as never);
    renderHook(useNewsDay, { wrapper });
    await waitFor(() => expect(newsDay()).toBeDefined());
    vi.spyOn(briefService, 'listNewsByDay').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({ data: ['b1'] } as never);

    await act(() => useBriefStore.getState().resolveBriefsAsRead(['b1']));

    // Without waiting for the re-read: the digest is a day's record, so the
    // brief stays there, resolved.
    expect(newsDay()?.news.map((brief) => [brief.id, Boolean(brief.resolvedAt)])).toEqual([
      ['b1', true],
      ['b2', false],
    ]);
    await waitFor(async () => {
      const row = await briefNewsResource.storage!.get({ ...NEWS_STORAGE_KEY, scope });
      expect(row?.data.news[0].resolvedAt).toBeTruthy();
    });
  });

  it('does not restore a deleted brief from the persisted digest', async () => {
    vi.spyOn(briefService, 'listNewsByDay').mockResolvedValue({
      data: [createBrief('b1'), createBrief('b2')],
      hasEarlier: false,
    } as never);
    const { unmount } = renderHook(useNewsDay, { wrapper });
    await waitFor(() => expect(newsDay()).toBeDefined());
    vi.spyOn(briefService, 'delete').mockResolvedValue(undefined as never);

    await act(() => useBriefStore.getState().deleteBrief('b1'));
    expect(newsDay()?.news.map((brief) => brief.id)).toEqual(['b2']);

    await waitFor(async () => {
      const row = await briefNewsResource.storage!.get({ ...NEWS_STORAGE_KEY, scope });
      expect(row?.data.news.map((brief) => brief.id)).toEqual(['b2']);
    });

    // A reload: a fresh store hydrates the persisted day before the network answers.
    unmount();
    act(() => useBriefStore.setState({ ...initialBriefListState }));
    vi.spyOn(briefService, 'listNewsByDay').mockImplementation(() => new Promise(() => {}));
    renderHook(useNewsDay, { wrapper });
    await waitFor(() => expect(newsDay()?.news.map((brief) => brief.id)).toEqual(['b2']));
  });

  it('never shows the previous scope’s digest after a scope switch', async () => {
    vi.spyOn(briefService, 'listNewsByDay').mockResolvedValue({
      data: [createBrief('b1')],
      hasEarlier: false,
    } as never);
    const { rerender } = renderHook(useNewsDay, { wrapper });
    await waitFor(() => expect(newsDay()).toBeDefined());

    useScope(`brief-user-${randomUUID()}:personal`);
    vi.spyOn(briefService, 'listNewsByDay').mockImplementation(() => new Promise(() => {}));
    rerender();

    await waitFor(() => expect(newsDay()).toBeUndefined());
  });

  it('seeds the persisted feed and digest before Home mounts', async () => {
    await briefListResource.storage!.set(
      { ...STORAGE_KEY, scope },
      { data: [createBrief('cached-feed')], updatedAt: 1 },
    );
    await briefNewsResource.storage!.set(
      { ...NEWS_STORAGE_KEY, scope },
      { data: newsDayOf([createBrief('cached-news')]), updatedAt: 1 },
    );
    const listUnresolved = vi.spyOn(briefService, 'listUnresolved');
    const listNewsByDay = vi.spyOn(briefService, 'listNewsByDay');

    // No hook is mounted: this is the route loader before the first frame.
    await useBriefStore.getState().preHydrateInbox(DAY);

    expect(feed().map((brief) => brief.id)).toEqual(['cached-feed']);
    expect(newsDay()?.news.map((brief) => brief.id)).toEqual(['cached-news']);
    expect(listUnresolved).not.toHaveBeenCalled();
    expect(listNewsByDay).not.toHaveBeenCalled();
  });

  it('does not seed another scope’s rows', async () => {
    await briefNewsResource.storage!.set(
      { ...NEWS_STORAGE_KEY, scope },
      { data: newsDayOf([createBrief('mine')]), updatedAt: 1 },
    );
    await useBriefStore.getState().preHydrateInbox(DAY);
    expect(newsDay()).toBeDefined();

    useScope(`brief-user-${randomUUID()}:personal`);
    await useBriefStore.getState().preHydrateInbox(DAY);

    expect(newsDay()).toBeUndefined();
    expect(briefListSelectors.isBriefsInit(useBriefStore.getState())).toBe(false);
  });

  it('does not fetch while disabled', () => {
    const listNewsByDay = vi.spyOn(briefService, 'listNewsByDay');
    renderHook(() => useBriefStore((s) => s.useFetchNewsByDay)(false, DAY), { wrapper });
    expect(listNewsByDay).not.toHaveBeenCalled();
  });
});
