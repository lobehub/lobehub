/**
 * @vitest-environment happy-dom
 *
 * The experiment list and detail are `@lobechat/replica` resources whose views
 * are the eval store's flat `experimentList` / `experimentDetailMap` fields.
 * These tests pin the fetch orchestration and the write paths (create / update
 * / delete) at the boundary: which service call each action makes and that the
 * replica network sync is revalidated instead of a hand-written SWR `mutate`.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { useEvalStore } from '@/store/eval';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    createExperiment: vi.fn(),
    deleteExperiment: vi.fn(),
    getExperiment: vi.fn(),
    listExperiments: vi.fn(),
    updateExperiment: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const resetStore = () => {
  useEvalStore.setState({
    experimentDetailMap: {},
    experimentDetailReplica: createReplicaState(),
    experimentList: [],
    experimentListInit: false,
    experimentListReplica: createReplicaState(),
  });
};

/** The replica network sync of a resource, as registered with the SWR driver. */
const syncCalls = async (name: 'evalExperimentDetail' | 'evalExperimentList') => {
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

describe('ExperimentAction replica wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe('useFetchExperiments', () => {
    it('registers one list sync and fetches through the service', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.listExperiments).mockResolvedValue({
        data: [],
        success: true,
      } as any);

      renderHook(() => useEvalStore.getState().useFetchExperiments());

      const [list] = await syncCalls('evalExperimentList');
      expect(list).toBeDefined();
      await list.fetcher();
      expect(agentEvalService.listExperiments).toHaveBeenCalledTimes(1);
    });

    it('returns the pre-migration { data, isLoading, error, mutate } shape', () => {
      const { result } = renderHook(() => useEvalStore.getState().useFetchExperiments());
      expect(result.current).toMatchObject({ data: undefined, isLoading: true });
      expect(typeof result.current.mutate).toBe('function');
    });

    it('exposes the settled list through `data` once the store has init', () => {
      useEvalStore.setState({
        experimentList: [{ id: 'e1', name: 'Sweep' } as any],
        experimentListInit: true,
      });
      const { result } = renderHook(() => useEvalStore.getState().useFetchExperiments());
      expect(result.current.data).toEqual([{ id: 'e1', name: 'Sweep' }]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('useFetchExperimentDetail', () => {
    it('registers a detail sync keyed by id and fetches that page', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.getExperiment).mockResolvedValue({
        data: { id: 'e1', name: 'Sweep' },
        success: true,
      } as any);

      renderHook(() => useEvalStore.getState().useFetchExperimentDetail('e1'));

      const [detail] = await syncCalls('evalExperimentDetail');
      expect(detail).toBeDefined();
      await detail.fetcher();
      expect(agentEvalService.getExperiment).toHaveBeenCalledWith('e1');
    });

    it('is inert while no id is given', () => {
      const { result } = renderHook(() => useEvalStore.getState().useFetchExperimentDetail());
      expect(typeof result.current.mutate).toBe('function');
    });
  });

  describe('refreshExperiments / refreshExperimentDetail', () => {
    it('revalidates the list replica instead of a hand-written SWR key', async () => {
      await useEvalStore.getState().refreshExperiments();
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalExperimentList', 1, 'anon:personal', 'all', {}]),
        ),
      ).toBe(true);
    });

    it('revalidates one detail entry by id', async () => {
      await useEvalStore.getState().refreshExperimentDetail('e1');
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalExperimentDetail', 1, 'anon:personal', 'e1', 'e1']),
        ),
      ).toBe(true);
    });
  });

  describe('createExperiment', () => {
    it('creates through the service, refreshes the list, and returns the created row', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.createExperiment).mockResolvedValue({
        data: { id: 'e1', name: 'Sweep' },
        success: true,
      } as any);

      const result = await useEvalStore.getState().createExperiment({
        benchmarkIds: ['b1'],
        name: 'Sweep',
      });

      expect(agentEvalService.createExperiment).toHaveBeenCalledWith({
        benchmarkIds: ['b1'],
        name: 'Sweep',
      });
      expect(result).toEqual({ id: 'e1', name: 'Sweep' });
      const matchers = await revalidationMatchers();
      expect(matchers.length).toBeGreaterThan(0);
    });
  });

  describe('deleteExperiment', () => {
    it('deletes through the service and drops the experiment from every copy', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.deleteExperiment).mockResolvedValue(undefined as any);
      useEvalStore.setState({
        experimentDetailMap: { e1: { id: 'e1', name: 'Sweep' } as any },
        experimentList: [{ id: 'e1', name: 'Sweep' } as any],
        experimentListInit: true,
      });

      await useEvalStore.getState().deleteExperiment('e1');

      expect(agentEvalService.deleteExperiment).toHaveBeenCalledWith('e1');
      expect(useEvalStore.getState().experimentDetailMap.e1).toBeUndefined();
      expect(useEvalStore.getState().experimentList).toEqual([]);
      // The optimistic removal keeps the list settled (init stays true).
      expect(useEvalStore.getState().experimentListInit).toBe(true);
    });

    it('restores the deleted row when the server rejects the delete', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.deleteExperiment).mockRejectedValue(new Error('boom'));
      useEvalStore.setState({
        experimentList: [{ id: 'e1', name: 'Sweep' } as any],
        experimentListInit: true,
      });

      await expect(useEvalStore.getState().deleteExperiment('e1')).rejects.toThrow('boom');
      expect(useEvalStore.getState().experimentList).toEqual([{ id: 'e1', name: 'Sweep' }]);
    });
  });

  describe('updateExperiment', () => {
    it('updates through the service then revalidates list and detail', async () => {
      const { agentEvalService } = await import('@/services/agentEval');
      vi.mocked(agentEvalService.updateExperiment).mockResolvedValue(undefined as any);

      await useEvalStore.getState().updateExperiment({ id: 'e1', name: 'New' });

      expect(agentEvalService.updateExperiment).toHaveBeenCalledWith({ id: 'e1', name: 'New' });
      const matchers = await revalidationMatchers();
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalExperimentList', 1, 'anon:personal', 'all', {}]),
        ),
      ).toBe(true);
      expect(
        matchers.some((m) =>
          m(['replica:sync', 'evalExperimentDetail', 1, 'anon:personal', 'e1', 'e1']),
        ),
      ).toBe(true);
    });
  });
});
