import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import useSWR, { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { useRouteRetry } from './useRouteRetry';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    SWRConfig,
    {
      value: {
        dedupingInterval: 0,
        provider: () => new Map(),
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      },
    },
    children,
  );

describe('useRouteRetry', () => {
  it('revalidates only the keys that failed, leaving the rest of the cache alone', async () => {
    const shellFetcher = vi.fn().mockResolvedValue('shell');
    const routeFetcher = vi.fn().mockResolvedValue('route');

    const { result } = renderHook(
      () => ({
        retry: useRouteRetry(),
        route: useSWR('route-key', routeFetcher),
        shell: useSWR('shell-key', shellFetcher),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.shell.data).toBe('shell');
      expect(result.current.route.data).toBe('route');
    });
    expect(shellFetcher).toHaveBeenCalledTimes(1);
    expect(routeFetcher).toHaveBeenCalledTimes(1);

    result.current.retry.onError(new Error('boom'), 'route-key');
    result.current.retry.onReset();

    await waitFor(() => expect(routeFetcher).toHaveBeenCalledTimes(2));
    expect(shellFetcher).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no key has failed', async () => {
    const shellFetcher = vi.fn().mockResolvedValue('shell');

    const { result } = renderHook(
      () => ({ retry: useRouteRetry(), shell: useSWR('shell-key', shellFetcher) }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.shell.data).toBe('shell'));

    result.current.retry.onReset();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(shellFetcher).toHaveBeenCalledTimes(1);
  });

  it('clears the recorded keys so a later reset does not replay them', async () => {
    const routeFetcher = vi.fn().mockResolvedValue('route');

    const { result } = renderHook(
      () => ({ retry: useRouteRetry(), route: useSWR('route-key', routeFetcher) }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.route.data).toBe('route'));

    result.current.retry.onError(new Error('boom'), 'route-key');
    result.current.retry.onReset();
    await waitFor(() => expect(routeFetcher).toHaveBeenCalledTimes(2));

    result.current.retry.onReset();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(routeFetcher).toHaveBeenCalledTimes(2);
  });
});
