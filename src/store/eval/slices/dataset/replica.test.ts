/**
 * @vitest-environment happy-dom
 *
 * The dataset lists (benchmark-scoped + scope-wide) and the dataset detail are
 * `@lobechat/replica` resources whose views are `datasetListMap` /
 * `datasetDetailMap`. This suite drives the real replica sync through SWR (no
 * mocked fetch hook) to show the behaviour the migration must preserve: a
 * persisted list paints while the network answers, a server response settles
 * and persists the view, each benchmark keeps its own entry, the scope-wide
 * list has its own key, a detail page fills its map entry, and a cache-scope
 * switch drops the previous identity's rows.
 */
import { randomUUID } from 'node:crypto';

import type { AgentEvalDatasetListItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import { ALL_DATASETS_KEY, datasetDetailResource, datasetListResource } from './projection';

const ALL_PARAMS = {} as Record<string, never>;
const BENCH = 'bench-1';
const DETAIL_ID = 'd1';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    // `shouldRetryOnError: false`: a NOT_FOUND revalidation must settle now, not
    // through SWR's backoff timers.
    { value: { dedupingInterval: 0, provider: () => new Map(), shouldRetryOnError: false } },
    createElement(MutateBridge),
    children,
  );

const BENCH_STORAGE_KEY = datasetListResource.storageKey({ benchmarkId: BENCH });
const ALL_STORAGE_KEY = datasetListResource.storageKey(ALL_PARAMS);
const DETAIL_STORAGE_KEY = datasetDetailResource.storageKey(DETAIL_ID);

const listRow = (id: string, name: string) =>
  ({
    benchmarkId: BENCH,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id,
    identifier: id,
    name,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }) as AgentEvalDatasetListItem;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const renderBenchList = (benchmarkId: string = BENCH) =>
  renderHook(() => useEvalStore.getState().useFetchDatasets(benchmarkId), { wrapper });
const renderAllList = () =>
  renderHook(() => useEvalStore.getState().useFetchAllDatasets(), { wrapper });
const renderDetail = (id: string) =>
  renderHook(() => useEvalStore.getState().useFetchDatasetDetail(id), { wrapper });

const benchList = (benchmarkId: string = BENCH) =>
  useEvalStore.getState().datasetListMap[benchmarkId];

describe('dataset replica', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`eval-user-${randomUUID()}:personal`);
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        datasetListResource.storage!.remove({ queryKey: BENCH_STORAGE_KEY, scope: value }),
        datasetListResource.storage!.remove({ queryKey: ALL_STORAGE_KEY, scope: value }),
        datasetDetailResource.storage!.remove({ queryKey: DETAIL_STORAGE_KEY, scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted benchmark list before the network answers', async () => {
    await datasetListResource.storage!.set(
      { queryKey: BENCH_STORAGE_KEY, scope },
      { data: [listRow('d1', 'Cached')], updatedAt: 1 },
    );
    vi.spyOn(agentEvalService, 'listDatasets').mockImplementation(pending);

    renderBenchList();

    await waitFor(() => expect(benchList()?.[0]?.name).toBe('Cached'));
  });

  it('settles the benchmark list from the server and persists it', async () => {
    vi.spyOn(agentEvalService, 'listDatasets').mockResolvedValue([listRow('d1', 'MMLU')]);

    renderBenchList();

    await waitFor(() => expect(benchList()?.[0]?.name).toBe('MMLU'));
    expect(agentEvalService.listDatasets).toHaveBeenCalledWith(BENCH);
    await waitFor(async () =>
      expect(
        (await datasetListResource.storage!.get({ queryKey: BENCH_STORAGE_KEY, scope }))?.data?.[0]
          ?.name,
      ).toBe('MMLU'),
    );
  });

  it('keeps each benchmark’s list under its own key', async () => {
    vi.spyOn(agentEvalService, 'listDatasets').mockImplementation(
      async (benchmarkId: string) => [listRow(`${benchmarkId}-row`, benchmarkId)] as any,
    );

    renderHook(
      () => {
        useEvalStore.getState().useFetchDatasets('bench-a');
        useEvalStore.getState().useFetchDatasets('bench-b');
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(benchList('bench-a')?.[0]?.name).toBe('bench-a');
      expect(benchList('bench-b')?.[0]?.name).toBe('bench-b');
    });
  });

  it('reads the scope-wide list from its own entry', async () => {
    const listAll = vi
      .spyOn(agentEvalService, 'listAllDatasets')
      .mockResolvedValue([listRow('d1', 'Every')]);
    const listBenchmark = vi.spyOn(agentEvalService, 'listDatasets');

    renderAllList();

    await waitFor(() =>
      expect(useEvalStore.getState().datasetListMap[ALL_DATASETS_KEY]?.[0]?.name).toBe('Every'),
    );
    expect(listAll).toHaveBeenCalledTimes(1);
    expect(listBenchmark).not.toHaveBeenCalled();
  });

  it('fills the detail map from the server', async () => {
    vi.spyOn(agentEvalService, 'getDataset').mockResolvedValue({
      id: DETAIL_ID,
      name: 'MMLU',
    } as any);

    renderDetail(DETAIL_ID);

    await waitFor(() =>
      expect(useEvalStore.getState().datasetDetailMap[DETAIL_ID]?.name).toBe('MMLU'),
    );
    expect(agentEvalService.getDataset).toHaveBeenCalledWith(DETAIL_ID);
  });

  it('keeps embedded test cases out of the stored and persisted detail', async () => {
    vi.spyOn(agentEvalService, 'getDataset').mockResolvedValue({
      id: DETAIL_ID,
      name: 'MMLU',
      testCases: [{ id: 'tc-1' }, { id: 'tc-2' }],
    } as any);

    renderDetail(DETAIL_ID);

    await waitFor(() =>
      expect(useEvalStore.getState().datasetDetailMap[DETAIL_ID]?.name).toBe('MMLU'),
    );
    expect(useEvalStore.getState().datasetDetailMap[DETAIL_ID]).not.toHaveProperty('testCases');
    await waitFor(async () => {
      const persisted = await datasetDetailResource.storage!.get({
        queryKey: DETAIL_STORAGE_KEY,
        scope,
      });
      expect(persisted?.data).toEqual({ id: DETAIL_ID, name: 'MMLU' });
    });
  });

  it('drops a persisted detail when its revalidation answers NOT_FOUND', async () => {
    const getDataset = vi
      .spyOn(agentEvalService, 'getDataset')
      .mockResolvedValue({ id: DETAIL_ID, name: 'MMLU' } as any);

    renderDetail(DETAIL_ID);
    await waitFor(() =>
      expect(useEvalStore.getState().datasetDetailMap[DETAIL_ID]?.name).toBe('MMLU'),
    );
    await waitFor(async () =>
      expect(
        (await datasetDetailResource.storage!.get({ queryKey: DETAIL_STORAGE_KEY, scope }))?.data,
      ).toEqual({ id: DETAIL_ID, name: 'MMLU' }),
    );

    // Deleted elsewhere: every read now answers NOT_FOUND. The persisted row
    // must not keep the page painting a dataset that no longer exists.
    getDataset.mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    await act(async () => {
      await useEvalStore
        .getState()
        .refreshDatasetDetail(DETAIL_ID)
        .catch(() => {});
    });

    await waitFor(() =>
      expect(useEvalStore.getState().datasetDetailMap[DETAIL_ID]).toBeUndefined(),
    );
    await waitFor(async () =>
      expect(
        await datasetDetailResource.storage!.get({ queryKey: DETAIL_STORAGE_KEY, scope }),
      ).toBeUndefined(),
    );
  });

  it('repaints the refreshed benchmark list after a mutation', async () => {
    const listDatasets = vi
      .spyOn(agentEvalService, 'listDatasets')
      .mockResolvedValue([listRow('d1', 'Before')]);
    renderBenchList();
    await waitFor(() => expect(benchList()?.[0]?.name).toBe('Before'));

    listDatasets.mockResolvedValue([listRow('d1', 'After')]);
    await act(() => useEvalStore.getState().refreshDatasets(BENCH));

    await waitFor(() => expect(benchList()?.[0]?.name).toBe('After'));
  });

  it('drops the previous scope’s lists on a cache-scope switch', async () => {
    vi.spyOn(agentEvalService, 'listDatasets').mockResolvedValue([listRow('d1', 'Personal')]);
    const { rerender } = renderBenchList();
    await waitFor(() => expect(benchList()).toHaveLength(1));

    // Switch identity: the new scope's rows are still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    vi.mocked(agentEvalService.listDatasets).mockImplementation(pending);
    rerender();

    expect(useEvalStore.getState().datasetListMap[BENCH]).toBeUndefined();
  });
});
