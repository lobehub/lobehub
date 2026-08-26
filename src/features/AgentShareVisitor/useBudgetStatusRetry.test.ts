import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshSharedAgentStatus: vi.fn(),
}));

vi.mock('./useSharedAgent', () => ({
  refreshSharedAgentStatus: mocks.refreshSharedAgentStatus,
}));

const { useBudgetStatusRetry } = await import('./useBudgetStatusRetry');

describe('useBudgetStatusRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the share is not currently blocked', async () => {
    const { result } = renderHook(() => useBudgetStatusRetry('share-1', undefined));

    await act(async () => {
      await result.current.retryBlockedCheck();
    });

    expect(mocks.refreshSharedAgentStatus).not.toHaveBeenCalled();
  });

  it('surfaces a retry failure instead of silently swallowing it', async () => {
    mocks.refreshSharedAgentStatus.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useBudgetStatusRetry('share-1', 'blocked-key'));

    await act(async () => {
      await result.current.retryBlockedCheck();
    });

    await waitFor(() => {
      expect(result.current.retryCheckError).toBeInstanceOf(Error);
    });
    expect(result.current.checkingBlock).toBe(false);
  });

  it('clears a prior retry-check error once a later attempt succeeds', async () => {
    mocks.refreshSharedAgentStatus
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useBudgetStatusRetry('share-1', 'blocked-key'));

    await act(async () => {
      await result.current.retryBlockedCheck();
    });
    expect(result.current.retryCheckError).toBeInstanceOf(Error);

    await act(async () => {
      await result.current.retryBlockedCheck();
    });

    expect(result.current.retryCheckError).toBeUndefined();
    expect(mocks.refreshSharedAgentStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores a concurrent retry while one is already in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    mocks.refreshSharedAgentStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useBudgetStatusRetry('share-1', 'blocked-key'));

    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.retryBlockedCheck();
    });
    expect(result.current.checkingBlock).toBe(true);

    // A second click while the first request is still in flight must be a no-op.
    await act(async () => {
      await result.current.retryBlockedCheck();
    });
    expect(mocks.refreshSharedAgentStatus).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await act(async () => {
      await firstCall;
    });
  });
});
