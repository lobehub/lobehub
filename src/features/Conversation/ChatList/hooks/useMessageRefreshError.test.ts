/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMessageRefreshError } from './useMessageRefreshError';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('useMessageRefreshError', () => {
  it('keeps the error stable during SWR automatic revalidation', async () => {
    const error = new Error('offline');
    const mutate = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ currentError, isValidating }) =>
        useMessageRefreshError({
          error: currentError,
          identity: 'topic-1',
          isValidating,
          mutate,
        }),
      { initialProps: { currentError: error as unknown, isValidating: false } },
    );

    expect(result.current.error).toBe(error);
    expect(result.current.isRetrying).toBe(false);

    rerender({ currentError: undefined, isValidating: true });
    expect(result.current.error).toBe(error);
    expect(result.current.isRetrying).toBe(false);
    expect(mutate).not.toHaveBeenCalled();

    rerender({ currentError: undefined, isValidating: false });
    await waitFor(() => expect(result.current.error).toBeUndefined());
  });

  it('tracks only an explicit Retry and prevents duplicate clicks', async () => {
    const pending = deferred();
    const mutate = vi.fn(() => pending.promise);
    const error = new Error('offline');
    const { result } = renderHook(() =>
      useMessageRefreshError({
        error,
        identity: 'topic-1',
        isValidating: true,
        mutate,
      }),
    );
    let retryPromise!: Promise<void>;

    act(() => {
      retryPromise = result.current.retry();
      void result.current.retry();
    });

    expect(result.current.isRetrying).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await retryPromise;
    });

    expect(result.current.isRetrying).toBe(false);
  });

  it('keeps a repeated Retry failure actionable', async () => {
    const retryError = new Error('still offline');
    const mutate = vi.fn().mockRejectedValue(retryError);
    const { result } = renderHook(() =>
      useMessageRefreshError({
        error: undefined,
        identity: 'topic-1',
        isValidating: false,
        mutate,
      }),
    );

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.error).toBe(retryError);
    expect(result.current.isRetrying).toBe(false);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('does not leak a retained error into a different message-list identity', () => {
    const error = new Error('topic 1 is offline');
    const mutate = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ currentError, identity }) =>
        useMessageRefreshError({
          error: currentError,
          identity,
          isValidating: false,
          mutate,
        }),
      { initialProps: { currentError: error as unknown, identity: 'topic-1' } },
    );

    expect(result.current.error).toBe(error);

    rerender({ currentError: undefined, identity: 'topic-2' });

    expect(result.current.error).toBeUndefined();
    expect(result.current.isRetrying).toBe(false);
  });

  it('ignores an old Retry failure after the message-list identity changes', async () => {
    let rejectRetry!: (error: Error) => void;
    const mutate = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectRetry = reject;
        }),
    );
    const { result, rerender } = renderHook(
      ({ identity }) =>
        useMessageRefreshError({
          error: undefined,
          identity,
          isValidating: false,
          mutate,
        }),
      { initialProps: { identity: 'topic-1' } },
    );

    let retryPromise!: Promise<void>;
    act(() => {
      retryPromise = result.current.retry();
    });
    rerender({ identity: 'topic-2' });

    await act(async () => {
      rejectRetry(new Error('old topic failed'));
      await retryPromise;
    });

    expect(result.current.error).toBeUndefined();
    expect(result.current.isRetrying).toBe(false);
  });
});
