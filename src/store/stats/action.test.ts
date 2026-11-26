/**
 * @vitest-environment happy-dom
 *
 * Every stats read is a replica persisted to IndexedDB: a reload paints the
 * last numbers before the network answers, then the server's answer replaces
 * them.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { usageService } from '@/services/usage';

import { statsActions } from './action';
import { initialState } from './initialState';
import {
  statsHeatmapResource,
  statsRankResource,
  statsTotalResource,
  usageByDayResource,
  usageLogsResource,
} from './projection';
import { statsSelectors } from './selectors';
import { useStatsStore } from './store';

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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const cells = (...counts: number[]) =>
  counts.map((count, index) => ({ count, date: `2026-01-0${index + 1}`, level: count ? 1 : 0 }));

const read = () => useStatsStore.getState();

describe('stats replicas', () => {
  let scope = '';
  const resources = [
    statsHeatmapResource,
    statsRankResource,
    statsTotalResource,
    usageByDayResource,
    usageLogsResource,
  ];

  beforeEach(() => {
    scope = `stats-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useStatsStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    for (const resource of resources) {
      await resource.storage!.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    }
    vi.restoreAllMocks();
  });

  it('paints a persisted total before the network answers, then replaces it', async () => {
    await statsTotalResource.storage!.set(
      { queryKey: statsTotalResource.storageKey('topics'), scope },
      { data: { count: 5, prevCount: 3 }, updatedAt: 1 },
    );
    const count = deferred<number>();
    vi.spyOn(topicService, 'countTopics').mockReturnValue(count.promise);

    renderHook(() => statsActions.useFetchTotal('topics'), { wrapper });

    await waitFor(() =>
      expect(statsSelectors.total('topics')(read())).toEqual({ count: 5, prevCount: 3 }),
    );

    await act(async () => count.resolve(9));
    await waitFor(() => expect(statsSelectors.total('topics')(read())?.count).toBe(9));
  });

  it('reads a restored empty heatmap as unconfirmed until the server answers', async () => {
    await statsHeatmapResource.storage!.set(
      { queryKey: statsHeatmapResource.storageKey('tokens'), scope },
      { data: [], updatedAt: 1 },
    );
    const network = deferred<ReturnType<typeof cells>>();
    vi.spyOn(messageService, 'getTokenHeatmaps').mockReturnValue(network.promise);

    renderHook(() => statsActions.useFetchHeatmap('tokens'), { wrapper });

    await waitFor(() => expect(statsSelectors.heatmap('tokens')(read())).toEqual([]));
    expect(statsSelectors.settledHeatmap('tokens')(read())).toBeUndefined();

    await act(async () => network.resolve([]));
    await waitFor(() => expect(statsSelectors.settledHeatmap('tokens')(read())).toEqual([]));
  });

  it('keeps a restored empty ranking unsettled until the server confirms it', async () => {
    await statsRankResource.storage!.set(
      { queryKey: statsRankResource.storageKey('topics'), scope },
      { data: [], updatedAt: 1 },
    );
    const network = deferred<never[]>();
    vi.spyOn(topicService, 'rankTopics').mockReturnValue(network.promise);

    renderHook(() => statsActions.useFetchRank('topics'), { wrapper });

    await waitFor(() => expect(statsSelectors.rank('topics')(read())).toEqual([]));
    expect(statsSelectors.settledRank('topics')(read())).toBeUndefined();

    await act(async () => network.resolve([]));
    await waitFor(() => expect(statsSelectors.settledRank('topics')(read())).toEqual([]));
  });

  it('surfaces the error when a restored empty ranking fails to refresh', async () => {
    await statsRankResource.storage!.set(
      { queryKey: statsRankResource.storageKey('models'), scope },
      { data: [], updatedAt: 1 },
    );
    vi.spyOn(messageService, 'rankModels').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => statsActions.useFetchRank('models'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // Unsettled data + an error: the card's AsyncBoundary renders the error and Retry.
    expect(statsSelectors.settledRank('models')(read())).toBeUndefined();
  });

  it('settles a restored non-empty ranking at once', async () => {
    const stored = [{ count: 3, id: 'gpt', name: 'gpt' }];
    await statsRankResource.storage!.set(
      { queryKey: statsRankResource.storageKey('models'), scope },
      { data: stored as never, updatedAt: 1 },
    );
    vi.spyOn(messageService, 'rankModels').mockReturnValue(new Promise(() => {}));

    renderHook(() => statsActions.useFetchRank('models'), { wrapper });

    await waitFor(() => expect(statsSelectors.settledRank('models')(read())).toEqual(stored));
  });

  it('answers every card that reads the token heatmap with one request', async () => {
    const spy = vi.spyOn(messageService, 'getTokenHeatmaps').mockResolvedValue(cells(1, 2));

    // TotalTokens, AiHeatmaps and HeatmapStats mount together on the page.
    renderHook(
      () => {
        statsActions.useFetchHeatmap('tokens');
        statsActions.useFetchHeatmap('tokens');
        statsActions.useFetchHeatmap('tokens');
      },
      { wrapper },
    );

    await waitFor(() => expect(statsSelectors.heatmap('tokens')(read())).toHaveLength(2));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps the last numbers when a background refresh fails', async () => {
    await statsHeatmapResource.storage!.set(
      { queryKey: statsHeatmapResource.storageKey('messages'), scope },
      { data: cells(4), updatedAt: 1 },
    );
    vi.spyOn(messageService, 'getHeatmaps').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => statsActions.useFetchHeatmap('messages'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(statsSelectors.heatmap('messages')(read())).toEqual(cells(4));
  });

  it('reads each picked month under its own entry', async () => {
    const spy = vi
      .spyOn(usageService, 'findAndGroupByDay')
      .mockImplementation(async (mo) => [{ day: mo }] as never);
    const thisMonth = dayjs().format('YYYY-MM');

    const { rerender } = renderHook(
      ({ month }: { month?: string }) => statsActions.useFetchUsageByDay(month),
      { initialProps: {} as { month?: string }, wrapper },
    );
    await waitFor(() => expect(statsSelectors.usageByDay()(read())).toEqual([{ day: thisMonth }]));
    // No picked month reads this calendar month by name.
    expect(spy).toHaveBeenLastCalledWith(thisMonth);

    rerender({ month: '2026-01' });
    await waitFor(() =>
      expect(statsSelectors.usageByDay('2026-01')(read())).toEqual([{ day: '2026-01' }]),
    );
    expect(spy).toHaveBeenLastCalledWith('2026-01');
    // The current month's copy is still there to switch back to.
    expect(statsSelectors.usageByDay()(read())).toEqual([{ day: thisMonth }]);
  });

  it("does not paint last month's usage under a new month", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 1, 3));
    await usageByDayResource.storage!.set(
      { queryKey: usageByDayResource.storageKey('2026-01'), scope },
      { data: [{ day: 'january' }] as never, updatedAt: 1 },
    );
    const network = deferred<never[]>();
    const spy = vi.spyOn(usageService, 'findAndGroupByDay').mockReturnValue(network.promise);

    const { result } = renderHook(() => statsActions.useFetchUsageByDay(), { wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(statsSelectors.usageByDay()(read())).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('2026-02');

    await act(async () => network.resolve([{ day: 'february' }] as never));
    await waitFor(() => expect(statsSelectors.usageByDay()(read())).toEqual([{ day: 'february' }]));
    vi.useRealTimers();
  });

  it('surfaces the error when a restored empty usage table fails to refresh', async () => {
    await usageLogsResource.storage!.set(
      { queryKey: usageLogsResource.storageKey('2026-01'), scope },
      { data: [], updatedAt: 1 },
    );
    vi.spyOn(usageService, 'findByMonth').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => statsActions.useFetchUsageLogs('2026-01'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // Unsettled data + an error: the table's AsyncBoundary renders the error and Retry.
    expect(statsSelectors.settledUsageLogs('2026-01')(read())).toBeUndefined();
  });

  it('surfaces the error when a restored empty heatmap fails to refresh', async () => {
    await statsHeatmapResource.storage!.set(
      { queryKey: statsHeatmapResource.storageKey('messages'), scope },
      { data: [], updatedAt: 1 },
    );
    vi.spyOn(messageService, 'getHeatmaps').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => statsActions.useFetchHeatmap('messages'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(statsSelectors.settledHeatmap('messages')(read())).toBeUndefined();
  });

  it('reads a restored empty usage table as unconfirmed until the server answers', async () => {
    await usageLogsResource.storage!.set(
      { queryKey: usageLogsResource.storageKey('2026-01'), scope },
      { data: [], updatedAt: 1 },
    );
    const network = deferred<never[]>();
    vi.spyOn(usageService, 'findByMonth').mockReturnValue(network.promise);

    renderHook(() => statsActions.useFetchUsageLogs('2026-01'), { wrapper });

    await waitFor(() => expect(statsSelectors.usageLogs('2026-01')(read())).toEqual([]));
    expect(statsSelectors.settledUsageLogs('2026-01')(read())).toBeUndefined();

    await act(async () => network.resolve([]));
    await waitFor(() => expect(statsSelectors.settledUsageLogs('2026-01')(read())).toEqual([]));
  });

  it('seeds the stats page from storage before any card mounts', async () => {
    await statsTotalResource.storage!.set(
      { queryKey: statsTotalResource.storageKey('agents'), scope },
      { data: { count: 14, prevCount: 1 }, updatedAt: 1 },
    );
    await statsHeatmapResource.storage!.set(
      { queryKey: statsHeatmapResource.storageKey('tokens'), scope },
      { data: cells(3), updatedAt: 1 },
    );
    await usageByDayResource.storage!.set(
      { queryKey: usageByDayResource.storageKey(dayjs().format('YYYY-MM')), scope },
      { data: [{ day: 'stored' }] as never, updatedAt: 1 },
    );

    await statsActions.preHydrateStatsPage();

    // No `useSync` has mounted: the route loader alone filled the store.
    expect(statsSelectors.total('agents')(read())).toEqual({ count: 14, prevCount: 1 });
    expect(statsSelectors.heatmap('tokens')(read())).toEqual(cells(3));
    expect(statsSelectors.usageByDay()(read())).toEqual([{ day: 'stored' }]);
    expect(statsSelectors.settledHeatmap('tokens')(read())).toEqual(cells(3));
  });

  it("drops the previous identity's numbers on reset", async () => {
    vi.spyOn(topicService, 'countTopics').mockResolvedValue(3);
    renderHook(() => statsActions.useFetchTotal('topics'), { wrapper });
    await waitFor(() => expect(statsSelectors.total('topics')(read())?.count).toBe(3));
    cleanup();

    act(() => statsActions.reset());

    expect(statsSelectors.total('topics')(read())).toBeUndefined();
    await waitFor(async () =>
      expect(
        await statsTotalResource.storage!.get({
          queryKey: statsTotalResource.storageKey('topics'),
          scope,
        }),
      ).toBeUndefined(),
    );
  });
});
