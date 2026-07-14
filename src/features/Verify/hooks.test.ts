import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import type { Cache } from 'swr';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';

import { useVerifyReportBundle, useVerifyReportSummariesInfinite } from './hooks';

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
