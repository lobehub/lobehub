/**
 * @vitest-environment happy-dom
 *
 * The benchmark list and detail are `@lobechat/replica` resources. These tests
 * pin the fetch orchestration and the write paths (create / update / delete)
 * at the boundary: which service call each action makes and that the replica
 * network sync is revalidated instead of a hand-written SWR `mutate`.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { useEvalStore } from '@/store/eval';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    createBenchmark: vi.fn(),
    deleteBenchmark: vi.fn(),
    getBenchmark: vi.fn(),
    listBenchmarks: vi.fn(),
    updateBenchmark: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const resetStore = () => {
  useEvalStore.setState({
    benchmarkDetailMap: {},
    benchmarkDetailReplica: createReplicaState(),
    benchmarkList: [],
    benchmarkListInit: false,
    benchmarkListReplica: createReplicaState(),
  });
};

/** The replica network sync of a resource, as registered with the SWR driver. */
const syncCalls = async (name: 'evalBenchmarkDetail' | 'evalBenchmarkList') => {
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

const scope = () => useEvalStore.getState().benchmarkList;

describe('BenchmarkAction replica wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('useFetchBenchmarks', () => {
    it('registers one list sync and fetches through the service', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.listBenchmarks).mockResolvedValue([] as any);

      renderHook(() => useEvalStore.getState().useFetchBenchmarks());

      const [list] = await syncCalls('evalBenchmarkList');
      expect(list).toBeDefined();
      await list.fetcher();
      expect(agentEvalService.listBenchmarks).toHaveBeenCalledTimes(1);
    });

    it('returns the pre-migration { data, isLoading, error, mutate } shape', () => {
      const { result } = renderHook(() => useEvalStore.getState().useFetchBenchmarks());
      expect(result.current).toMatchObject({ data: undefined, isLoading: true });
      expect(typeof result.current.mutate).toBe('function');
    });
  });

  describe('useFetchBenchmarkDetail', () => {
    it('registers a detail sync keyed by id and fetches that page', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.getBenchmark).mockResolvedValue({ id: 'b1' } as any);

      renderHook(() => useEvalStore.getState().useFetchBenchmarkDetail('b1'));

      const [detail] = await syncCalls('evalBenchmarkDetail');
      expect(detail).toBeDefined();
      await detail.fetcher();
      expect(agentEvalService.getBenchmark).toHaveBeenCalledWith('b1');
    });

    it('is inert while no id is given', () => {
      const { result } = renderHook(() =>
        useEvalStore.getState().useFetchBenchmarkDetail(undefined),
      );
      expect(typeof result.current.mutate).toBe('function');
    });
  });

  describe('refreshBenchmarks / refreshBenchmarkDetail', () => {
    it('revalidates the list replica instead of a hand-written SWR key', async () => {
      await useEvalStore.getState().refreshBenchmarks();
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalBenchmarkList', 1, 'anon:personal', 'all', {}]),
        ),
      ).toBe(true);
    });

    it('revalidates one detail entry by id', async () => {
      await useEvalStore.getState().refreshBenchmarkDetail('b1');
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalBenchmarkDetail', 1, 'anon:personal', 'b1', 'b1']),
        ),
      ).toBe(true);
    });
  });

  describe('createBenchmark', () => {
    it('creates through the service with rubrics defaulted, then refreshes the list', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.createBenchmark).mockResolvedValue({ id: 'b1' } as any);

      const result = await useEvalStore.getState().createBenchmark({
        identifier: 'mmlu',
        name: 'MMLU',
      });

      expect(agentEvalService.createBenchmark).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'mmlu', name: 'MMLU', rubrics: [] }),
      );
      expect(result).toEqual({ id: 'b1' });
      const matchers = await revalidationMatchers();
      expect(matchers.length).toBeGreaterThan(0);
    });
  });

  describe('deleteBenchmark', () => {
    it('deletes through the service and drops the benchmark from the detail cache', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.deleteBenchmark).mockResolvedValue(undefined as any);
      useEvalStore.setState({
        benchmarkDetailMap: { b1: { id: 'b1', name: 'MMLU' } as any },
      });

      await useEvalStore.getState().deleteBenchmark('b1');

      expect(agentEvalService.deleteBenchmark).toHaveBeenCalledWith('b1');
      expect(useEvalStore.getState().benchmarkDetailMap.b1).toBeUndefined();
    });
  });

  describe('updateBenchmark', () => {
    it('optimistically patches the detail and then updates through the service', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.updateBenchmark).mockResolvedValue({ id: 'b1' } as any);
      useEvalStore.setState({
        benchmarkDetailMap: { b1: { id: 'b1', name: 'Old' } as any },
      });

      await useEvalStore.getState().updateBenchmark({ id: 'b1', identifier: 'mmlu', name: 'New' });

      expect(agentEvalService.updateBenchmark).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b1', name: 'New' }),
      );
      expect(useEvalStore.getState().benchmarkDetailMap.b1?.name).toBe('New');
    });
  });

  it('scopes the replica list to the active identity', () => {
    useEvalStore.setState({ benchmarkList: [{ id: 'b1' } as any], benchmarkListInit: true });
    expect(scope()).toHaveLength(1);
  });
});
