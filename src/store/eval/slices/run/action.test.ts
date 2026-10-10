/**
 * @vitest-environment happy-dom
 *
 * `eval/slices/run` is replica-backed: the benchmark / dataset run lists, the
 * run detail and the run results all paint from the persisted copy on the first
 * frame, the network only confirms, a delete fans out to every loaded copy, and
 * the mutation actions keep the same service calls they had before the move.
 */
import { randomUUID } from 'node:crypto';

import type { AgentEvalRunDetail, AgentEvalRunListItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';
import { runSelectors } from '@/store/eval/slices/run/selectors';

import { runInitialState } from './initialState';
import {
  benchmarkRunListResource,
  datasetRunListResource,
  runDetailResource,
  runResultsResource,
} from './projection';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    abortRun: vi.fn(),
    batchResumeRunCases: vi.fn(),
    createRun: vi.fn(),
    deleteRun: vi.fn(),
    getRunDetails: vi.fn(),
    getRunResults: vi.fn(),
    listRuns: vi.fn(),
    retryRunCase: vi.fn(),
    retryRunErrors: vi.fn(),
    resumeRunCase: vi.fn(),
    startRun: vi.fn(),
    updateRun: vi.fn(),
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
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const BENCH = 'bench-1';
const DATASET = 'dataset-1';
const RUN = 'run-1';

const run = (id: string, extra: Partial<AgentEvalRunListItem> = {}): AgentEvalRunListItem =>
  ({
    datasetId: DATASET,
    id,
    status: 'idle',
    createdAt: new Date(1),
    updatedAt: new Date(1),
    ...extra,
  }) as AgentEvalRunListItem;

const detailOf = (item: AgentEvalRunListItem): AgentEvalRunDetail =>
  ({ ...item, topics: [] }) as AgentEvalRunDetail;

const okList = (data: AgentEvalRunListItem[]) => ({ data, total: data.length });

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const BENCH_KEY = benchmarkRunListResource.storageKey({ benchmarkId: BENCH });
const DATASET_KEY = datasetRunListResource.storageKey({ datasetId: DATASET });
const DETAIL_KEY = runDetailResource.storageKey(RUN);

describe('eval run slice replicas', () => {
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
    useScope(`eval-run-user-${randomUUID()}:personal`);
    act(() => useEvalStore.setState(runInitialState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        [BENCH_KEY, DATASET_KEY, DETAIL_KEY, runResultsResource.storageKey(RUN)].map((queryKey) =>
          benchmarkRunListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted benchmark run list before the network answers', async () => {
    await benchmarkRunListResource.storage!.set(
      { queryKey: BENCH_KEY, scope },
      { data: [run('r1', { name: 'Cached' })], updatedAt: 1 },
    );
    vi.mocked(agentEvalService.listRuns).mockImplementation(pending);

    const sync = renderHook(() => useEvalStore((s) => s.useFetchRuns)(BENCH), { wrapper });
    const list = renderHook(() => useEvalStore(runSelectors.runList(BENCH)));

    await waitFor(() => expect(list.result.current.map((r) => r.name)).toEqual(['Cached']));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the benchmark run list with the server response and persists it', async () => {
    vi.mocked(agentEvalService.listRuns).mockResolvedValue(
      okList([run('r1', { name: 'Server' })]) as any,
    );

    renderHook(() => useEvalStore((s) => s.useFetchRuns)(BENCH), { wrapper });

    await waitFor(() =>
      expect(useEvalStore.getState().runListMap[BENCH]?.[0]?.name).toBe('Server'),
    );
    expect(agentEvalService.listRuns).toHaveBeenCalledWith({ benchmarkId: BENCH });
    await waitFor(async () =>
      expect(
        (await benchmarkRunListResource.storage!.get({ queryKey: BENCH_KEY, scope }))?.data,
      ).toEqual([run('r1', { name: 'Server' })]),
    );
  });

  it('keeps each benchmark’s run list under its own key', async () => {
    vi.mocked(agentEvalService.listRuns).mockImplementation(
      async ({ benchmarkId }: { benchmarkId?: string }) =>
        okList([run(`${benchmarkId}-run`, { name: benchmarkId })]) as any,
    );

    renderHook(
      () => {
        useEvalStore((s) => s.useFetchRuns)('bench-a');
        useEvalStore((s) => s.useFetchRuns)('bench-b');
      },
      { wrapper },
    );

    await waitFor(() => {
      const state = useEvalStore.getState();
      expect(state.runListMap['bench-a']?.[0]?.name).toBe('bench-a');
      expect(state.runListMap['bench-b']?.[0]?.name).toBe('bench-b');
    });
  });

  it('hydrates run detail by id and revalidates it through the same entry', async () => {
    await runDetailResource.storage!.set(
      { queryKey: DETAIL_KEY, scope },
      { data: detailOf(run(RUN, { name: 'Cached run' })), updatedAt: 1 },
    );
    vi.mocked(agentEvalService.getRunDetails).mockImplementation(pending);

    renderHook(() => useEvalStore((s) => s.useFetchRunDetail)(RUN), { wrapper });

    await waitFor(() => expect(useEvalStore.getState().runDetailMap[RUN]?.name).toBe('Cached run'));
    expect(agentEvalService.getRunDetails).toHaveBeenCalledWith(RUN);
  });

  it('refreshes a run detail after a mutation through the service', async () => {
    vi.mocked(agentEvalService.getRunDetails).mockResolvedValue(
      detailOf(run(RUN, { status: 'running' })) as any,
    );
    vi.mocked(agentEvalService.startRun).mockResolvedValue(undefined as any);

    renderHook(() => useEvalStore((s) => s.useFetchRunDetail)(RUN), { wrapper });
    await waitFor(() => expect(useEvalStore.getState().runDetailMap[RUN]).toBeDefined());

    vi.mocked(agentEvalService.getRunDetails).mockResolvedValue(
      detailOf(run(RUN, { status: 'completed' })) as any,
    );

    await act(() => useEvalStore.getState().startRun(RUN));

    expect(agentEvalService.startRun).toHaveBeenCalledWith(RUN, undefined);
    await waitFor(() =>
      expect(useEvalStore.getState().runDetailMap[RUN]?.status).toBe('completed'),
    );
  });

  it('removes a deleted run from the list and its detail copy', async () => {
    vi.mocked(agentEvalService.listRuns).mockResolvedValue(
      okList([run(RUN, { name: 'Doomed' })]) as any,
    );
    vi.mocked(agentEvalService.getRunDetails).mockResolvedValue(
      detailOf(run(RUN, { name: 'Doomed' })) as any,
    );

    renderHook(
      () => {
        useEvalStore((s) => s.useFetchRuns)(BENCH);
        useEvalStore((s) => s.useFetchRunDetail)(RUN);
      },
      { wrapper },
    );
    await waitFor(() => {
      expect(useEvalStore.getState().runListMap[BENCH]).toHaveLength(1);
      expect(useEvalStore.getState().runDetailMap[RUN]).toBeDefined();
    });

    vi.mocked(agentEvalService.deleteRun).mockResolvedValue({ success: true } as any);
    vi.mocked(agentEvalService.listRuns).mockResolvedValue(okList([]) as any);

    await act(() => useEvalStore.getState().deleteRun(RUN));

    expect(agentEvalService.deleteRun).toHaveBeenCalledWith(RUN);
    expect(useEvalStore.getState().runListMap[BENCH]).toEqual([]);
    expect(useEvalStore.getState().runDetailMap[RUN]).toBeUndefined();
  });

  it('scopes the dataset run list by datasetId', async () => {
    vi.mocked(agentEvalService.listRuns).mockResolvedValue(
      okList([run('r9', { name: 'DS run' })]) as any,
    );

    renderHook(() => useEvalStore((s) => s.useFetchDatasetRuns)(DATASET), { wrapper });

    await waitFor(() =>
      expect(useEvalStore.getState().datasetRunListMap[DATASET]?.[0]?.name).toBe('DS run'),
    );
    expect(agentEvalService.listRuns).toHaveBeenCalledWith({ datasetId: DATASET });
  });

  it('creates a run and refreshes the mounted benchmark run list', async () => {
    vi.mocked(agentEvalService.listRuns).mockResolvedValue(okList([run('r1')]) as any);
    vi.mocked(agentEvalService.createRun).mockResolvedValue({ id: 'r2' } as any);

    renderHook(() => useEvalStore((s) => s.useFetchRuns)(BENCH), { wrapper });
    await waitFor(() =>
      expect(agentEvalService.listRuns).toHaveBeenCalledWith({ benchmarkId: BENCH }),
    );
    vi.mocked(agentEvalService.listRuns).mockClear();
    vi.mocked(agentEvalService.listRuns).mockResolvedValue(
      okList([run('r1'), run('r2', { name: 'New run' })]) as any,
    );

    const created = await act(() =>
      useEvalStore.getState().createRun({ datasetId: DATASET, name: 'New run' }),
    );

    expect(created).toEqual({ id: 'r2' });
    expect(agentEvalService.createRun).toHaveBeenCalledWith({
      datasetId: DATASET,
      name: 'New run',
    });
    // `createRun` revalidates the benchmark list that is currently mounted.
    expect(agentEvalService.listRuns).toHaveBeenCalledWith({ benchmarkId: BENCH });
    await waitFor(() =>
      expect(useEvalStore.getState().runListMap[BENCH]?.map((r) => r.id)).toEqual(['r1', 'r2']),
    );
  });
});
