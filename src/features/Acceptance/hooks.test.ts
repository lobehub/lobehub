import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import type { Cache } from 'swr';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';

import {
  getAcceptanceBySubjectRefreshInterval,
  useAcceptanceBySubject,
  useAcceptanceList,
} from './hooks';

const createSWRWrapper = (cache: Cache) =>
  function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children);
  };

describe('Verify data hooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('checks for a missing acceptance slowly, then keeps one live until it settles', () => {
    // Regression: a missing acceptance was polled every 2s for as long as the page stayed open.
    expect(getAcceptanceBySubjectRefreshInterval(undefined)).toBe(10_000);
    expect(getAcceptanceBySubjectRefreshInterval(null)).toBe(10_000);
    // A task page left open through a goal loop would otherwise keep rendering
    // whatever state it first saw, all the way through delivery.
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'verifying' })).toBe(5000);
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'delivered' })).toBe(5000);
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'accepted' })).toBe(0);
    expect(getAcceptanceBySubjectRefreshInterval({ id: 'a1', status: 'closed' })).toBe(0);
  });

  // Regression: the task page mounts the state row and the acceptance section on the same
  // subject, and each polled it on its own timer; a reader opened seconds later (the result
  // portal) kept a second chain.
  it('shares one poll between readers of the same subject, even mounted seconds apart', async () => {
    vi.useFakeTimers();
    try {
      const getAcceptanceBySubject = vi
        .spyOn(verifyService, 'getAcceptanceBySubject')
        .mockResolvedValue({ id: 'a1', status: 'verifying' } as never);
      const wrapper = createSWRWrapper(new Map());
      renderHook(() => useAcceptanceBySubject('task', 'T-shared'), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      renderHook(() => useAcceptanceBySubject('task', 'T-shared'), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const calls = getAcceptanceBySubject.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50_000);
      });
      expect(getAcceptanceBySubject.mock.calls.length - calls).toBeLessThanOrEqual(11);
    } finally {
      vi.useRealTimers();
    }
  });
});
