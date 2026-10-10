/**
 * @vitest-environment happy-dom
 *
 * The experiment list and detail are `@lobechat/replica` resources whose views
 * are the eval store's flat `experimentList` / `experimentDetailMap` fields.
 * This suite drives the real replica sync through SWR (no mocked fetch hook) to
 * show the behaviour the migration must preserve: a persisted list paints while
 * the network answers, a server response settles the view, a detail page fills
 * its map entry (and surfaces a failed load instead of hanging on a skeleton),
 * and a cache-scope switch drops the previous identity's rows.
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

import { experimentDetailResource, experimentListResource } from './projection';

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

const LIST_STORAGE_KEY = experimentListResource.storageKey(LIST_PARAMS);
const DETAIL_STORAGE_KEY = experimentDetailResource.storageKey('e1');

const listRow = (id: string, name: string) =>
  ({ createdAt: new Date('2026-01-01T00:00:00.000Z'), id, name }) as any;
const detailPage = (id: string, name: string) => ({ datasets: [], id, name, runs: [] }) as any;
const listResponse = (rows: any[]) => ({ data: rows, success: true }) as any;
const detailResponse = (page: any) => ({ data: page, success: true }) as any;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const renderListSync = () =>
  renderHook(() => useEvalStore.getState().useFetchExperiments(), { wrapper });
const renderDetailSync = (id?: string) =>
  renderHook(() => useEvalStore.getState().useFetchExperimentDetail(id), { wrapper });

describe('experiment replica', () => {
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
        experimentListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope: value }),
      ),
    );
    await Promise.all(
      [...scopes].map((value) =>
        experimentDetailResource.storage!.remove({ queryKey: DETAIL_STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await experimentListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [listRow('e1', 'Cached')], updatedAt: 1 },
    );
    vi.spyOn(agentEvalService, 'listExperiments').mockImplementation(pending);

    renderListSync();

    await waitFor(() => expect(useEvalStore.getState().experimentListInit).toBe(true));
    expect(useEvalStore.getState().experimentList[0].name).toBe('Cached');
  });

  it('settles the list (and marks it init) from the server', async () => {
    vi.spyOn(agentEvalService, 'listExperiments').mockResolvedValue(
      listResponse([listRow('e1', 'Sweep')]),
    );

    renderListSync();

    await waitFor(() => expect(useEvalStore.getState().experimentListInit).toBe(true));
    expect(useEvalStore.getState().experimentList).toHaveLength(1);
    expect(useEvalStore.getState().experimentList[0].name).toBe('Sweep');
  });

  it('drops the previous scope’s list on a cache-scope switch', async () => {
    vi.spyOn(agentEvalService, 'listExperiments').mockResolvedValue(
      listResponse([listRow('e1', 'Personal')]),
    );
    const { rerender } = renderListSync();
    await waitFor(() => expect(useEvalStore.getState().experimentList).toHaveLength(1));

    // Switch identity: the new scope's rows are still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    vi.mocked(agentEvalService.listExperiments).mockImplementation(pending);
    rerender();

    expect(useEvalStore.getState().experimentList).toEqual([]);
    expect(useEvalStore.getState().experimentListInit).toBe(false);
  });

  it('fills the detail map from the server', async () => {
    vi.spyOn(agentEvalService, 'getExperiment').mockResolvedValue(
      detailResponse(detailPage('e1', 'Sweep')),
    );

    renderDetailSync('e1');

    await waitFor(() => expect(useEvalStore.getState().experimentDetailMap.e1).toBeDefined());
    expect(useEvalStore.getState().experimentDetailMap.e1.name).toBe('Sweep');
  });

  it('surfaces a failed detail load instead of holding the loading state', async () => {
    vi.spyOn(agentEvalService, 'getExperiment').mockRejectedValue(new Error('offline'));

    const { result } = renderDetailSync('e1');

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
    expect(useEvalStore.getState().experimentDetailMap.e1).toBeUndefined();
  });

  it('repaints the refreshed list after a mutation', async () => {
    const listExperiments = vi
      .spyOn(agentEvalService, 'listExperiments')
      .mockResolvedValue(listResponse([listRow('e1', 'Before')]));
    renderListSync();
    await waitFor(() => expect(useEvalStore.getState().experimentList).toHaveLength(1));

    listExperiments.mockResolvedValue(listResponse([listRow('e1', 'After')]));
    await act(() => useEvalStore.getState().refreshExperiments());

    await waitFor(() => expect(useEvalStore.getState().experimentList[0].name).toBe('After'));
  });
});
