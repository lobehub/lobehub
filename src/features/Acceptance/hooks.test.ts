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
  useAcceptanceList,
  useRubrics,
  useVerifyReportBundle,
} from './hooks';

const useSWRInfiniteMock = vi.hoisted(() => vi.fn());

vi.mock('swr/infinite', () => ({ default: useSWRInfiniteMock }));

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

  it('keeps a subject without an acceptance out of loading while it polls', async () => {
    const getAcceptanceBySubject = vi
      .spyOn(verifyService, 'getAcceptanceBySubject')
      .mockResolvedValue(null as never);

    const { result } = renderHook(() => useAcceptanceBySubject('task', 'T-864'), {
      wrapper: createSWRWrapper(new Map()),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A background poll of a subject known to have no acceptance must not flip
    // the caller back to its loading placeholder on every tick.
    let resolveNext!: (value: null) => void;
    getAcceptanceBySubject.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve;
      }) as never,
    );
    let revalidation!: Promise<unknown>;
    act(() => {
      revalidation = result.current.mutate();
    });
    await waitFor(() => expect(result.current.isValidating).toBe(true));
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      resolveNext(null);
      await revalidation;
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('forwards the project scope to the acceptance list service', async () => {
    const listAcceptances = vi.spyOn(verifyService, 'listAcceptances').mockResolvedValue([]);

    renderHook(() => useAcceptanceList(true, { filter: 'all', projectId: 'project-1' }), {
      wrapper: createSWRWrapper(new Map()),
    });

    await waitFor(() => expect(listAcceptances).toHaveBeenCalledOnce());
    expect(listAcceptances).toHaveBeenCalledWith({
      filter: 'all',
      limit: undefined,
      projectId: 'project-1',
      q: undefined,
    });
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

  it('does not request rubrics while rubric authoring is inactive', async () => {
    const listRubrics = vi.spyOn(verifyService, 'listRubrics').mockResolvedValue([]);

    renderHook(() => useRubrics(false), { wrapper: createSWRWrapper(new Map()) });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(listRubrics).not.toHaveBeenCalled();
  });
});
