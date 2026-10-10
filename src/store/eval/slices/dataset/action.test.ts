/**
 * @vitest-environment happy-dom
 *
 * The dataset lists (benchmark-scoped + scope-wide) and the dataset detail are
 * `@lobechat/replica` resources. These tests pin the fetch orchestration at the
 * boundary: which service call each hook registers, the pre-migration return
 * shapes, and that the refresh actions revalidate the replica sync instead of a
 * hand-written SWR `mutate`.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { useEvalStore } from '@/store/eval';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    getDataset: vi.fn(),
    listAllDatasets: vi.fn(),
    listDatasets: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const resetStore = () => {
  useEvalStore.setState({
    datasetDetailMap: {},
    datasetDetailReplica: createReplicaState(),
    datasetListMap: {},
    datasetListReplica: createReplicaState(),
  });
};

/** The replica network sync of a resource, as registered with the SWR driver. */
const syncCalls = async (name: 'evalDatasetDetail' | 'evalDatasetList') => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, fetcher]) => ({ fetcher: fetcher as () => Promise<any>, key: key as unknown[] }));
};

/** Capture the `mutate` matchers a refresh registered. */
const revalidationMatchers = async () => {
  const { mutate } = await import('@/libs/swr');
  return vi
    .mocked(mutate)
    .mock.calls.map(([arg]) => arg)
    .filter((arg): arg is (key: unknown) => boolean => typeof arg === 'function');
};

describe('DatasetAction replica wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('useFetchDatasets', () => {
    it('registers a benchmark sync and fetches that benchmark’s datasets', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.listDatasets).mockResolvedValue([] as any);

      renderHook(() => useEvalStore.getState().useFetchDatasets('bench-1'));

      const [list] = await syncCalls('evalDatasetList');
      expect(list).toBeDefined();
      await list.fetcher();
      expect(agentEvalService.listDatasets).toHaveBeenCalledWith('bench-1');
      expect(agentEvalService.listAllDatasets).not.toHaveBeenCalled();
    });

    it('is inert while no benchmark id is given', () => {
      const { result } = renderHook(() => useEvalStore.getState().useFetchDatasets(undefined));
      expect(typeof result.current.revalidate).toBe('function');
    });
  });

  describe('useFetchAllDatasets', () => {
    it('registers the scope-wide sync and lists every dataset', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.listAllDatasets).mockResolvedValue([] as any);

      renderHook(() => useEvalStore.getState().useFetchAllDatasets());

      const [list] = await syncCalls('evalDatasetList');
      expect(list).toBeDefined();
      await list.fetcher();
      expect(agentEvalService.listAllDatasets).toHaveBeenCalledTimes(1);
      expect(agentEvalService.listDatasets).not.toHaveBeenCalled();
    });

    it('returns the pre-migration { data, isLoading, mutate } shape', () => {
      const { result } = renderHook(() => useEvalStore.getState().useFetchAllDatasets());
      expect(result.current).toMatchObject({ data: undefined, isLoading: true });
      expect(typeof result.current.mutate).toBe('function');
    });
  });

  describe('useFetchDatasetDetail', () => {
    it('registers a detail sync keyed by id and fetches that page', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.getDataset).mockResolvedValue({ id: 'd1' } as any);

      renderHook(() => useEvalStore.getState().useFetchDatasetDetail('d1'));

      const [detail] = await syncCalls('evalDatasetDetail');
      expect(detail).toBeDefined();
      await detail.fetcher();
      expect(agentEvalService.getDataset).toHaveBeenCalledWith('d1');
    });

    it('returns the pre-migration { data, error, isLoading, mutate } shape and is inert without an id', () => {
      const { result } = renderHook(() => useEvalStore.getState().useFetchDatasetDetail(undefined));
      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBeUndefined();
      expect(typeof result.current.mutate).toBe('function');
    });
  });

  describe('refreshDatasets / refreshDatasetDetail', () => {
    it('revalidates one benchmark list entry through its replica sync', async () => {
      await useEvalStore.getState().refreshDatasets('bench-1');
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m([
            'replica:sync',
            'evalDatasetList',
            1,
            'anon:personal',
            'bench-1',
            { benchmarkId: 'bench-1' },
          ]),
        ),
      ).toBe(true);
    });

    it('revalidates one detail entry by id', async () => {
      await useEvalStore.getState().refreshDatasetDetail('d1');
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalDatasetDetail', 1, 'anon:personal', 'd1', 'd1']),
        ),
      ).toBe(true);
    });
  });

  it('no longer exposes the retired reducer internals', () => {
    const state = useEvalStore.getState() as Record<string, unknown>;
    expect(state.internal_dispatchDatasetDetail).toBeUndefined();
    expect(state.internal_updateDatasetDetailLoading).toBeUndefined();
    expect(state.isLoadingDatasets).toBeUndefined();
    expect(state.loadingDatasetDetailIds).toBeUndefined();
  });
});
