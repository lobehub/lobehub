import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import type { Cache } from 'swr';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';

import {
  getAcceptanceBySubjectRefreshInterval,
  useAcceptanceBySubject,
  useRubrics,
  useVerifyReportBundle,
  useVerifyReportSummariesInfinite,
} from './hooks';

const useSWRInfiniteMock = vi.hoisted(() => vi.fn());

vi.mock('swr/infinite', () => ({ default: useSWRInfiniteMock }));

const mockInfiniteResponse = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  error: undefined,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
  setSize: vi.fn(),
  size: 1,
  ...overrides,
});

const createSWRWrapper = (cache: Cache) =>
  function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children);
  };

describe('Verify data hooks', () => {
  beforeEach(() => {
    useSWRInfiniteMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses a cached report bundle without revalidating after a remount', async () => {
    const getReportBundle = vi.spyOn(verifyService, 'getReportBundle').mockResolvedValue(null);
    const wrapper = createSWRWrapper(new Map());

    const firstMount = renderHook(() => useVerifyReportBundle('run-1'), { wrapper });
    await waitFor(() => expect(getReportBundle).toHaveBeenCalledTimes(1));
    firstMount.unmount();

    const secondMount = renderHook(() => useVerifyReportBundle('run-1'), { wrapper });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(secondMount.result.current.data).toBeNull();
    expect(getReportBundle).toHaveBeenCalledTimes(1);
  });

  it('loads an acceptance by its task subject identifier', async () => {
    const getAcceptanceBySubject = vi
      .spyOn(verifyService, 'getAcceptanceBySubject')
      .mockResolvedValue({ id: 'acceptance-1' } as never);

    const { result } = renderHook(() => useAcceptanceBySubject('task', 'T-231'), {
      wrapper: createSWRWrapper(new Map()),
    });

    await waitFor(() => expect(result.current.data).toEqual({ id: 'acceptance-1' }));
    expect(getAcceptanceBySubject).toHaveBeenCalledWith('task', 'T-231');
  });

  it('polls fastest before an acceptance exists, then keeps it live until it settles', () => {
    expect(getAcceptanceBySubjectRefreshInterval(undefined)).toBe(2000);
    expect(getAcceptanceBySubjectRefreshInterval(null)).toBe(2000);
    // A task page left open through a goal loop would otherwise keep rendering
    // whatever state it first saw, all the way through delivery.
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'verifying' })).toBe(5000);
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'delivered' })).toBe(5000);
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'accepted' })).toBe(0);
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'closed' })).toBe(0);
  });

  it('stops polling once a previously-seen acceptance is removed, instead of treating it as still discovering', () => {
    // Never seen: keep discovering fast — this is the pre-existing behaviour.
    expect(getAcceptanceBySubjectRefreshInterval(undefined, false)).toBe(2000);
    expect(getAcceptanceBySubjectRefreshInterval(null, false)).toBe(2000);
    // Seen once, now null: the aggregate existed and was deleted (e.g. via
    // "Remove acceptance"). The endpoint cannot tell this apart from
    // "never created" — the caller-supplied flag is what breaks the tie.
    expect(getAcceptanceBySubjectRefreshInterval(undefined, true)).toBe(0);
    expect(getAcceptanceBySubjectRefreshInterval(null, true)).toBe(0);
  });

  it('flips useAcceptanceBySubject to stop polling after the aggregate is removed', async () => {
    const getAcceptanceBySubject = vi.spyOn(verifyService, 'getAcceptanceBySubject');
    getAcceptanceBySubject.mockResolvedValueOnce({
      id: 'acceptance-1',
      status: 'verifying',
    } as never);

    const { rerender, result } = renderHook(
      ({ subjectId }: { subjectId: string | null }) => useAcceptanceBySubject('task', subjectId),
      { initialProps: { subjectId: 'T-231' }, wrapper: createSWRWrapper(new Map()) },
    );

    await waitFor(() =>
      expect(result.current.data).toEqual({ id: 'acceptance-1', status: 'verifying' }),
    );

    // The task's acceptance config was removed server-side: the endpoint now
    // reports null for the same subject, same shape as "never created".
    getAcceptanceBySubject.mockResolvedValue(null);
    await result.current.mutate();
    await waitFor(() => expect(result.current.data).toBeNull());

    // A different subject that has never had an aggregate must still poll
    // fast — the sticky flag is per-subject, not global.
    getAcceptanceBySubject.mockResolvedValue(null);
    rerender({ subjectId: 'T-999' });
    await waitFor(() => expect(result.current.data).toBeUndefined());
  });

  it('does not request rubrics while rubric authoring is inactive', async () => {
    const listRubrics = vi.spyOn(verifyService, 'listRubrics').mockResolvedValue([]);

    renderHook(() => useRubrics(false), { wrapper: createSWRWrapper(new Map()) });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(listRubrics).not.toHaveBeenCalled();
  });

  it('keeps loaded reports visible while SWR revalidates after a remount', () => {
    useSWRInfiniteMock.mockReturnValue(
      mockInfiniteResponse({
        data: [{ items: [], nextCursor: null }],
        isLoading: true,
        isValidating: true,
      }),
    );

    const { result } = renderHook(() => useVerifyReportSummariesInfinite(''));

    expect(result.current.isLoadingInitial).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('reports initial loading only before the first page is available', () => {
    useSWRInfiniteMock.mockReturnValue(mockInfiniteResponse({ isLoading: true }));

    const { result } = renderHook(() => useVerifyReportSummariesInfinite(''));

    expect(result.current.isLoadingInitial).toBe(true);
    expect(result.current.isLoadingMore).toBe(false);
  });
});
