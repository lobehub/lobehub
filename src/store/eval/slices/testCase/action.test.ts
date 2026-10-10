/**
 * @vitest-environment happy-dom
 *
 * `eval/slices/testCase` is replica-backed: a dataset's case page and a single
 * case detail both paint from the persisted copy on the first frame, the network
 * only confirms, each dataset keeps its own page, and the mutation actions keep
 * the same service calls they had before the move.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';
import { testCaseSelectors } from '@/store/eval/slices/testCase/selectors';

import { testCaseInitialState } from './initialState';
import { testCaseDetailResource, testCaseListResource } from './projection';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    getTestCase: vi.fn(),
    listTestCases: vi.fn(),
    updateTestCase: vi.fn(),
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

const DATASET = 'dataset-1';
const CASE = 'case-1';
const PAGE = { datasetId: DATASET, limit: 10, offset: 0 };

const testCase = (id: string, extra: Record<string, unknown> = {}): any => ({
  content: { input: `input-${id}` },
  datasetId: DATASET,
  evalConfig: {},
  evalMode: 'rubric',
  id,
  metadata: {},
  sortOrder: 1,
  ...extra,
});

const okList = (data: any[]) => ({ data, total: data.length }) as any;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const LIST_KEY = testCaseListResource.storageKey(PAGE);
const DETAIL_KEY = testCaseDetailResource.storageKey(CASE);

describe('eval testCase slice replicas', () => {
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
    useScope(`eval-test-case-user-${randomUUID()}:personal`);
    act(() => useEvalStore.setState(testCaseInitialState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        [LIST_KEY, DETAIL_KEY].map((queryKey) =>
          testCaseListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted case page before the network answers', async () => {
    await testCaseListResource.storage!.set(
      { queryKey: LIST_KEY, scope },
      {
        data: { items: [testCase(CASE, { content: { input: 'Cached' } })], total: 1 },
        updatedAt: 1,
      },
    );
    vi.mocked(agentEvalService.listTestCases).mockImplementation(pending);

    const sync = renderHook(() => useEvalStore((s) => s.useFetchTestCases)(PAGE), { wrapper });
    const rows = renderHook(() => useEvalStore(testCaseSelectors.testCases(PAGE)));

    await waitFor(() => expect(rows.result.current[0]?.content?.input).toBe('Cached'));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the case page with the server response and persists it', async () => {
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(
      okList([testCase(CASE, { content: { input: 'Server' } })]),
    );

    renderHook(() => useEvalStore((s) => s.useFetchTestCases)(PAGE), { wrapper });

    await waitFor(() =>
      expect(useEvalStore.getState().testCaseListMap[DATASET]?.items?.[0]?.content?.input).toBe(
        'Server',
      ),
    );
    expect(agentEvalService.listTestCases).toHaveBeenCalledWith(PAGE);
    await waitFor(async () =>
      expect(
        (await testCaseListResource.storage!.get({ queryKey: LIST_KEY, scope }))?.data,
      ).toEqual({ items: [testCase(CASE, { content: { input: 'Server' } })], total: 1 }),
    );
  });

  it('keeps each dataset’s case page under its own key', async () => {
    vi.mocked(agentEvalService.listTestCases).mockImplementation(async ({ datasetId }: any) =>
      okList([testCase(`${datasetId}-c`, { content: { input: datasetId } })]),
    );

    renderHook(
      () => {
        useEvalStore((s) => s.useFetchTestCases)({ datasetId: 'ds-a', limit: 5, offset: 0 });
        useEvalStore((s) => s.useFetchTestCases)({ datasetId: 'ds-b', limit: 5, offset: 0 });
      },
      { wrapper },
    );

    await waitFor(() => {
      const state = useEvalStore.getState();
      expect(state.testCaseListMap['ds-a']?.items?.[0]?.content?.input).toBe('ds-a');
      expect(state.testCaseListMap['ds-b']?.items?.[0]?.content?.input).toBe('ds-b');
    });
  });

  it('never shows the previous page’s rows under the next page’s query', async () => {
    const PAGE_2 = { ...PAGE, offset: 10 };
    vi.mocked(agentEvalService.listTestCases).mockResolvedValueOnce(okList([testCase('page-1')]));

    const sync = renderHook(
      (query: typeof PAGE) => useEvalStore((s) => s.useFetchTestCases)(query),
      {
        initialProps: PAGE,
        wrapper,
      },
    );
    await waitFor(() =>
      expect(testCaseSelectors.testCases(PAGE)(useEvalStore.getState())[0]?.id).toBe('page-1'),
    );

    // Page 2 is still in flight, then fails: the entry keeps holding page 1.
    let reject!: (error: Error) => void;
    vi.mocked(agentEvalService.listTestCases).mockImplementationOnce(
      () => new Promise((_, r) => (reject = r)),
    );
    sync.rerender(PAGE_2);
    await waitFor(() => expect(agentEvalService.listTestCases).toHaveBeenCalledWith(PAGE_2));

    const state = () => useEvalStore.getState();
    expect(state().testCaseListMap[DATASET]?.items?.[0]?.id).toBe('page-1');
    expect(testCaseSelectors.testCases(PAGE_2)(state())).toEqual([]);
    expect(testCaseSelectors.isLoadingTestCases(PAGE_2)(state())).toBe(true);

    await act(async () => reject(new Error('network')));
    await waitFor(() => expect(sync.result.current.error).toBeTruthy());
    expect(testCaseSelectors.testCases(PAGE_2)(state())).toEqual([]);
    // The dataset-wide count stays usable for the pager meanwhile.
    expect(testCaseSelectors.testCaseTotal(DATASET)(state())).toBe(1);
  });

  it('disables the sync when no dataset is requested', async () => {
    renderHook(() => useEvalStore((s) => s.useFetchTestCases)(null), { wrapper });

    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(agentEvalService.listTestCases).not.toHaveBeenCalled();
  });

  it('hydrates a case detail by id and revalidates it through the same entry', async () => {
    await testCaseDetailResource.storage!.set(
      { queryKey: DETAIL_KEY, scope },
      { data: testCase(CASE, { content: { input: 'Cached case' } }), updatedAt: 1 },
    );
    vi.mocked(agentEvalService.getTestCase).mockImplementation(pending);

    const hook = renderHook(() => useEvalStore((s) => s.useFetchTestCase)(CASE), { wrapper });

    await waitFor(() => expect(hook.result.current.data?.content?.input).toBe('Cached case'));
    expect(agentEvalService.getTestCase).toHaveBeenCalledWith(CASE);
  });

  it('refreshTestCases revalidates the dataset page through the list replica', async () => {
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(okList([testCase(CASE)]));

    renderHook(() => useEvalStore((s) => s.useFetchTestCases)(PAGE), { wrapper });
    await waitFor(() => expect(agentEvalService.listTestCases).toHaveBeenCalledTimes(1));

    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(okList([]));
    await act(() => useEvalStore.getState().refreshTestCases(DATASET));

    await waitFor(() =>
      expect(useEvalStore.getState().testCaseListMap[DATASET]?.items).toEqual([]),
    );
  });

  it('refreshes the detail and the list after updateTestCase', async () => {
    vi.mocked(agentEvalService.getTestCase).mockResolvedValue(
      testCase(CASE, { content: { input: 'Before' } }) as any,
    );
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(
      okList([testCase(CASE, { content: { input: 'Before' } })]),
    );

    renderHook(
      () => {
        useEvalStore((s) => s.useFetchTestCase)(CASE);
        useEvalStore((s) => s.useFetchTestCases)(PAGE);
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(useEvalStore.getState().testCaseDetailMap[CASE]?.content?.input).toBe('Before'),
    );

    vi.mocked(agentEvalService.updateTestCase).mockResolvedValue(undefined as any);
    vi.mocked(agentEvalService.getTestCase).mockResolvedValue(
      testCase(CASE, { content: { input: 'After' } }) as any,
    );
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(
      okList([testCase(CASE, { content: { input: 'After' } })]),
    );

    await act(() =>
      useEvalStore.getState().updateTestCase(CASE, DATASET, { content: { input: 'After' } }),
    );

    expect(agentEvalService.updateTestCase).toHaveBeenCalledWith({
      content: { input: 'After' },
      id: CASE,
    });
    await waitFor(() =>
      expect(useEvalStore.getState().testCaseDetailMap[CASE]?.content?.input).toBe('After'),
    );
    await waitFor(() =>
      expect(useEvalStore.getState().testCaseListMap[DATASET]?.items?.[0]?.content?.input).toBe(
        'After',
      ),
    );
  });
});
