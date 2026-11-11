// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import { idSetKey } from './projection';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    getRunResults: vi.fn(),
    listAllDatasets: vi.fn(),
    listAllRuns: vi.fn(),
    listDatasets: vi.fn(),
    listEnvironments: vi.fn(),
    listTestCases: vi.fn(),
  },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map(), shouldRetryOnError: false } },
    createElement(MutateBridge),
    children,
  );

const dataset = (id: string, extra: Record<string, unknown> = {}) =>
  ({ createdAt: '2026-01-01T00:00:00.000Z', id, name: id, ...extra }) as never;

beforeEach(() => {
  vi.spyOn(cacheScope, 'get').mockReturnValue('eval-user:personal');
  vi.spyOn(cacheScope, 'use').mockReturnValue('eval-user:personal');
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
  useEvalStore.setState({
    datasetCaseListMap: {},
    lobeBenchDatasetListMap: {},
    lobeBenchRunListMap: {},
    runResultsByRunMap: {},
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Lobe Bench replicas', () => {
  it('keys a benchmark set by its members, not their order', () => {
    expect(idSetKey(['b', 'a'])).toBe(idSetKey(['a', 'b']));
    expect(idSetKey([])).not.toBe(idSetKey(['']));
  });

  it('lists benchmark datasets plus standalone Lobe Bench ones into the store', async () => {
    vi.mocked(agentEvalService.listDatasets).mockResolvedValue([
      dataset('in-bench', { benchmarkId: 'bench' }),
    ] as never);
    vi.mocked(agentEvalService.listAllDatasets).mockResolvedValue([
      dataset('in-bench', { benchmarkId: 'bench' }),
      dataset('imported', { metadata: { kind: 'lobe-bench' } }),
      dataset('lab-only'),
    ] as never);

    const { result } = renderHook(
      () => useEvalStore.getState().useFetchLobeBenchDatasets(['bench']),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.map((item: { id: string }) => item.id)).toEqual([
      'in-bench',
      'imported',
    ]);
    expect(useEvalStore.getState().lobeBenchDatasetListMap[idSetKey(['bench'])]).toBe(
      result.current.data,
    );
  });

  it('does not request runs or results without ids, and is not loading', async () => {
    const { result } = renderHook(
      () => ({
        results: useEvalStore.getState().useFetchRunResultsByRun([]),
        runs: useEvalStore.getState().useFetchLobeBenchRuns([]),
      }),
      { wrapper },
    );
    await Promise.resolve();
    expect(agentEvalService.listAllRuns).not.toHaveBeenCalled();
    expect(agentEvalService.getRunResults).not.toHaveBeenCalled();
    expect(result.current.runs.isLoading).toBe(false);
    expect(result.current.results.isLoading).toBe(false);
  });

  it('collects each run’s results under its id', async () => {
    vi.mocked(agentEvalService.getRunResults).mockImplementation(
      async (runId) => ({ results: [{ testCaseId: `${runId}-case` }] }) as never,
    );
    const { result } = renderHook(
      () => useEvalStore.getState().useFetchRunResultsByRun(['r1', 'r2']),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      r1: [{ testCaseId: 'r1-case' }],
      r2: [{ testCaseId: 'r2-case' }],
    });
  });

  it('re-reads a dataset’s cases after an import, without a mounted view', async () => {
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue({
      data: [{ id: 'case-1' }],
      total: 1,
    } as never);

    await act(() => useEvalStore.getState().refreshDatasetCases('set-1'));

    expect(agentEvalService.listTestCases).toHaveBeenCalledWith({
      datasetId: 'set-1',
      limit: 100,
      offset: 0,
    });
    expect(useEvalStore.getState().datasetCaseListMap['set-1']).toEqual([{ id: 'case-1' }]);
  });
});
