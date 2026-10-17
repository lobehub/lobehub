/**
 * @vitest-environment happy-dom
 *
 * The benchmark list and detail are `@lobechat/replica` resources whose views
 * are the eval store's flat `benchmarkList` / `benchmarkDetailMap` fields. This
 * suite drives the real replica sync through SWR (no mocked fetch hook) to show
 * the behaviour the migration must preserve: a persisted list paints while the
 * network answers, a server response settles the view, a detail page fills its
 * map entry, and a cache-scope switch drops the previous identity's rows.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import { benchmarkDetailResource, benchmarkListResource } from './projection';

const LIST_PARAMS = {} as Record<string, never>;

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

const LIST_STORAGE_KEY = benchmarkListResource.storageKey(LIST_PARAMS);
const DETAIL_STORAGE_KEY = benchmarkDetailResource.storageKey('b1');

const listRow = (id: string, name: string) =>
  ({
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id,
    identifier: id,
    isSystem: false,
    name,
  }) as any;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const renderListSync = () =>
  renderHook(() => useEvalStore.getState().useFetchBenchmarks(), { wrapper });
const renderDetailSync = (id: string) =>
  renderHook(() => useEvalStore.getState().useFetchBenchmarkDetail(id), { wrapper });

describe('benchmark replica', () => {
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
      [...scopes].map((value) =>
        benchmarkListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope: value }),
      ),
    );
    await Promise.all(
      [...scopes].map((value) =>
        benchmarkDetailResource.storage!.remove({ queryKey: DETAIL_STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await benchmarkListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [listRow('b1', 'Cached')], updatedAt: 1 },
    );
    vi.spyOn(agentEvalService, 'listBenchmarks').mockImplementation(pending);

    renderListSync();

    await waitFor(() => expect(useEvalStore.getState().benchmarkListInit).toBe(true));
    expect(useEvalStore.getState().benchmarkList[0].name).toBe('Cached');
  });

  it('settles the list (and marks it init) from the server', async () => {
    vi.spyOn(agentEvalService, 'listBenchmarks').mockResolvedValue([listRow('b1', 'MMLU')]);

    renderListSync();

    await waitFor(() => expect(useEvalStore.getState().benchmarkListInit).toBe(true));
    expect(useEvalStore.getState().benchmarkList).toHaveLength(1);
    expect(useEvalStore.getState().benchmarkList[0].name).toBe('MMLU');
  });

  it('drops the previous scope’s list on a cache-scope switch', async () => {
    vi.spyOn(agentEvalService, 'listBenchmarks').mockResolvedValue([listRow('b1', 'Personal')]);
    const { rerender } = renderListSync();
    await waitFor(() => expect(useEvalStore.getState().benchmarkList).toHaveLength(1));

    // Switch identity: the new scope's rows are still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    vi.mocked(agentEvalService.listBenchmarks).mockImplementation(pending);
    rerender();

    expect(useEvalStore.getState().benchmarkList).toEqual([]);
    expect(useEvalStore.getState().benchmarkListInit).toBe(false);
  });

  it('fills the detail map from the server', async () => {
    vi.spyOn(agentEvalService, 'getBenchmark').mockResolvedValue({ id: 'b1', name: 'MMLU' } as any);

    renderDetailSync('b1');

    await waitFor(() => expect(useEvalStore.getState().benchmarkDetailMap.b1).toBeDefined());
    expect(useEvalStore.getState().benchmarkDetailMap.b1.name).toBe('MMLU');
  });

  it('drops a hydrated detail and its persisted row on NOT_FOUND', async () => {
    await benchmarkDetailResource.storage!.set(
      { queryKey: DETAIL_STORAGE_KEY, scope },
      { data: { id: 'b1', name: 'Cached' } as any, updatedAt: 1 },
    );
    let rejectFetch: (error: unknown) => void = () => {};
    vi.spyOn(agentEvalService, 'getBenchmark').mockImplementation(
      () => new Promise((_, reject) => (rejectFetch = reject)),
    );

    renderDetailSync('b1');
    await waitFor(() => expect(useEvalStore.getState().benchmarkDetailMap.b1?.name).toBe('Cached'));

    await act(async () => {
      rejectFetch(Object.assign(new Error('Benchmark not found'), { data: { code: 'NOT_FOUND' } }));
    });

    await waitFor(() => expect(useEvalStore.getState().benchmarkDetailMap.b1).toBeUndefined());
    await waitFor(async () =>
      expect(
        await benchmarkDetailResource.storage!.get({ queryKey: DETAIL_STORAGE_KEY, scope }),
      ).toBeUndefined(),
    );
  });

  it('keeps a hydrated detail on a transient fetch failure', async () => {
    await benchmarkDetailResource.storage!.set(
      { queryKey: DETAIL_STORAGE_KEY, scope },
      { data: { id: 'b1', name: 'Cached' } as any, updatedAt: 1 },
    );
    const getBenchmark = vi
      .spyOn(agentEvalService, 'getBenchmark')
      .mockRejectedValue(
        Object.assign(new Error('boom'), { data: { code: 'INTERNAL_SERVER_ERROR' } }),
      );

    const { result } = renderDetailSync('b1');
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(getBenchmark).toHaveBeenCalled();

    expect(useEvalStore.getState().benchmarkDetailMap.b1?.name).toBe('Cached');
  });

  it('repaints the refreshed list after a mutation', async () => {
    const listBenchmarks = vi
      .spyOn(agentEvalService, 'listBenchmarks')
      .mockResolvedValue([listRow('b1', 'Before')]);
    renderListSync();
    await waitFor(() => expect(useEvalStore.getState().benchmarkList).toHaveLength(1));

    listBenchmarks.mockResolvedValue([listRow('b1', 'After')]);
    await act(() => useEvalStore.getState().refreshBenchmarks());

    await waitFor(() => expect(useEvalStore.getState().benchmarkList[0].name).toBe('After'));
  });
});
