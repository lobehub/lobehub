/**
 * @vitest-environment happy-dom
 *
 * `eval/slices/testCase` is replica-backed: every visited case page and a single
 * case detail paint from the persisted copy on the first frame, the network only
 * confirms, each page keeps its own entry (so returning to a page repaints its
 * cached rows instead of waiting on the network), and the mutation actions keep
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
import {
  testCaseDetailResource,
  type TestCaseListQuery,
  testCaseListResource,
} from './projection';

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
const PAGE: TestCaseListQuery = { datasetId: DATASET, limit: 10, offset: 0 };
/** A second page of the same dataset: the same entry shape, another window. */
const PAGE_2: TestCaseListQuery = { ...PAGE, offset: 10 };
const OTHER_PAGES: TestCaseListQuery[] = [
  { datasetId: 'ds-a', limit: 5, offset: 0 },
  { datasetId: 'ds-b', limit: 5, offset: 0 },
];

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

const listKey = (query: TestCaseListQuery) => testCaseListResource.storageKey(query);
const LIST_KEY = listKey(PAGE);
const PAGE_2_KEY = listKey(PAGE_2);
const DETAIL_KEY = testCaseDetailResource.storageKey(CASE);
const OTHER_KEYS = OTHER_PAGES.map(listKey);

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
        [DETAIL_KEY, LIST_KEY, PAGE_2_KEY, ...OTHER_KEYS].map((queryKey) =>
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
    // The count rides the page itself, so a hydrated page paints the pager too.
    expect(testCaseSelectors.testCaseTotal(PAGE)(useEvalStore.getState())).toBe(1);
  });

  it('replaces the case page with the server response and persists it', async () => {
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(
      okList([testCase(CASE, { content: { input: 'Server' } })]),
    );

    renderHook(() => useEvalStore((s) => s.useFetchTestCases)(PAGE), { wrapper });

    await waitFor(() =>
      expect(useEvalStore.getState().testCaseListMap[LIST_KEY]?.items?.[0]?.content?.input).toBe(
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
        useEvalStore((s) => s.useFetchTestCases)(OTHER_PAGES[0]);
        useEvalStore((s) => s.useFetchTestCases)(OTHER_PAGES[1]);
      },
      { wrapper },
    );

    await waitFor(() => {
      const state = useEvalStore.getState();
      expect(state.testCaseListMap[OTHER_KEYS[0]]?.items?.[0]?.content?.input).toBe('ds-a');
      expect(state.testCaseListMap[OTHER_KEYS[1]]?.items?.[0]?.content?.input).toBe('ds-b');
    });
  });

  it('keeps the previous page cached while the next page is in flight, then fails', async () => {
    vi.mocked(agentEvalService.listTestCases).mockResolvedValueOnce(okList([testCase('page-1')]));

    const sync = renderHook(
      (query: TestCaseListQuery) => useEvalStore((s) => s.useFetchTestCases)(query),
      { initialProps: PAGE, wrapper },
    );
    await waitFor(() =>
      expect(testCaseSelectors.testCases(PAGE)(useEvalStore.getState())[0]?.id).toBe('page-1'),
    );

    // Page 2 is still in flight, then fails: it is its own (empty) entry.
    let reject!: (error: Error) => void;
    vi.mocked(agentEvalService.listTestCases).mockImplementationOnce(
      () => new Promise((_, r) => (reject = r)),
    );
    sync.rerender(PAGE_2);
    await waitFor(() => expect(agentEvalService.listTestCases).toHaveBeenCalledWith(PAGE_2));

    const state = () => useEvalStore.getState();
    expect(state().testCaseListMap[LIST_KEY]?.items?.[0]?.id).toBe('page-1');
    expect(testCaseSelectors.testCases(PAGE_2)(state())).toEqual([]);
    expect(testCaseSelectors.isLoadingTestCases(PAGE_2)(state())).toBe(true);

    await act(async () => reject(new Error('network')));
    await waitFor(() => expect(sync.result.current.error).toBeTruthy());
    expect(testCaseSelectors.testCases(PAGE_2)(state())).toEqual([]);
    // The dataset-wide count stays usable for the pager meanwhile.
    expect(testCaseSelectors.testCaseTotal(PAGE_2)(state())).toBe(1);
  });

  it('paints a page from cache again when returning to it', async () => {
    vi.mocked(agentEvalService.listTestCases).mockImplementation(async (query: any) =>
      okList([testCase(query.offset === 0 ? 'page-1' : 'page-2')]),
    );

    const sync = renderHook(
      (query: TestCaseListQuery) => useEvalStore((s) => s.useFetchTestCases)(query),
      { initialProps: PAGE, wrapper },
    );
    await waitFor(() =>
      expect(testCaseSelectors.testCases(PAGE)(useEvalStore.getState())[0]?.id).toBe('page-1'),
    );
    sync.rerender(PAGE_2);
    await waitFor(() =>
      expect(testCaseSelectors.testCases(PAGE_2)(useEvalStore.getState())[0]?.id).toBe('page-2'),
    );

    // Back to page 1 with the network refusing to answer: its own entry is still
    // cached, so the rows paint instead of the table sitting empty.
    vi.mocked(agentEvalService.listTestCases).mockImplementation(pending);
    sync.rerender(PAGE);

    const state = () => useEvalStore.getState();
    expect(testCaseSelectors.testCases(PAGE)(state())[0]?.id).toBe('page-1');
    expect(testCaseSelectors.isLoadingTestCases(PAGE)(state())).toBe(false);
    expect(testCaseSelectors.testCases(PAGE_2)(state())[0]?.id).toBe('page-2');
  });

  it('keeps the hydrated count when switching to an uncached page', async () => {
    await testCaseListResource.storage!.set(
      { queryKey: LIST_KEY, scope },
      { data: { items: [testCase(CASE)], total: 7 }, updatedAt: 1 },
    );
    // Page 1 is restored from storage and the network never answers.
    vi.mocked(agentEvalService.listTestCases).mockImplementation(pending);

    const sync = renderHook(
      (query: TestCaseListQuery) => useEvalStore((s) => s.useFetchTestCases)(query),
      { initialProps: PAGE, wrapper },
    );
    await waitFor(() =>
      expect(testCaseSelectors.testCaseTotal(PAGE)(useEvalStore.getState())).toBe(7),
    );

    // Page 2 has no local copy yet, but the dataset count is still known.
    sync.rerender(PAGE_2);
    const state = () => useEvalStore.getState();
    expect(testCaseSelectors.testCases(PAGE_2)(state())).toEqual([]);
    expect(testCaseSelectors.testCaseTotal(PAGE_2)(state())).toBe(7);
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

  it('refreshTestCases revalidates the loaded case pages', async () => {
    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(okList([testCase(CASE)]));

    renderHook(() => useEvalStore((s) => s.useFetchTestCases)(PAGE), { wrapper });
    await waitFor(() => expect(agentEvalService.listTestCases).toHaveBeenCalledTimes(1));

    vi.mocked(agentEvalService.listTestCases).mockResolvedValue(okList([]));
    await act(() => useEvalStore.getState().refreshTestCases());

    await waitFor(() =>
      expect(useEvalStore.getState().testCaseListMap[LIST_KEY]?.items).toEqual([]),
    );
  });

  it('refreshes the detail and the loaded pages after updateTestCase', async () => {
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
      useEvalStore.getState().updateTestCase(CASE, { content: { input: 'After' } }),
    );

    expect(agentEvalService.updateTestCase).toHaveBeenCalledWith({
      content: { input: 'After' },
      id: CASE,
    });
    await waitFor(() =>
      expect(useEvalStore.getState().testCaseDetailMap[CASE]?.content?.input).toBe('After'),
    );
    await waitFor(() =>
      expect(useEvalStore.getState().testCaseListMap[LIST_KEY]?.items?.[0]?.content?.input).toBe(
        'After',
      ),
    );
  });
});
