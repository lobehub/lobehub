import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeterogeneousAutoRetry } from './useHeterogeneousAutoRetry';

// NOTE: every selected value must keep a STABLE identity across renders (the
// real store returns stable action refs). An inline arrow here would change
// each render → churn the effect and reset the countdown.
const storeMock = vi.hoisted(() => ({
  aborted: false,
  retryAvailable: true,
  hasOperation: true,
  attempts: {} as Record<string, number>,
  internal_beginHeteroOverloadWait: vi.fn(),
  internal_endHeteroOverloadWait: vi.fn(),
  isHeteroOverloadWaitAborted: vi.fn(() => false),
  markHeteroOverloadRetryExhausted: vi.fn(),
  recordHeteroOverloadRetry: vi.fn(),
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      heteroOverloadRetryAttempts: storeMock.attempts,
      internal_beginHeteroOverloadWait: storeMock.internal_beginHeteroOverloadWait,
      internal_endHeteroOverloadWait: storeMock.internal_endHeteroOverloadWait,
      isHeteroOverloadWaitAborted: storeMock.isHeteroOverloadWaitAborted,
      markHeteroOverloadRetryExhausted: storeMock.markHeteroOverloadRetryExhausted,
      recordHeteroOverloadRetry: storeMock.recordHeteroOverloadRetry,
    }),
}));

const runtimeMock = {
  abortController: new AbortController(),
  id: 'runtime-1',
  metadata: {
    get heteroAutoRetryAvailable() {
      return storeMock.retryAvailable;
    },
  },
  status: 'completed',
  type: 'execServerAgentRuntime',
};
const chatState = {
  messageOperationMap: { 'failed-step': 'runtime-1' },
  get operations() {
    return storeMock.hasOperation ? { 'runtime-1': runtimeMock } : {};
  },
  updateOperationMetadata: (_id: string, metadata: { heteroAutoRetryAvailable: boolean }) => {
    storeMock.retryAvailable = metadata.heteroAutoRetryAvailable;
  },
};
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    {
      getState: () => chatState,
    },
  ),
}));

const SCOPE = 'user-msg-1';

describe('useHeterogeneousAutoRetry', () => {
  beforeEach(() => {
    storeMock.attempts = {};
    storeMock.retryAvailable = true;
    storeMock.hasOperation = true;
    storeMock.recordHeteroOverloadRetry.mockClear();
    storeMock.markHeteroOverloadRetryExhausted.mockClear();
    storeMock.internal_beginHeteroOverloadWait.mockClear();
    storeMock.internal_endHeteroOverloadWait.mockClear();
    storeMock.isHeteroOverloadWaitAborted.mockReset();
    storeMock.isHeteroOverloadWaitAborted.mockReturnValue(false);
    vi.useFakeTimers();
    // Neutralize jitter so backoff is exactly the base window.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules an auto-retry and fires it after the first backoff window', () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    // first attempt: 2s window, shown as attempt 1 / 5
    expect(result.current?.attempt).toBe(1);
    expect(result.current?.maxAttempts).toBe(5);
    expect(result.current?.secondsLeft).toBe(2);
    expect(onRetry).not.toHaveBeenCalled();

    // A wait op is opened so the turn stays in its loading state while counting.
    expect(storeMock.internal_beginHeteroOverloadWait).toHaveBeenCalledWith(SCOPE);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Firing hands the wait off to the real attempt and bumps the counter.
    expect(storeMock.internal_endHeteroOverloadWait).toHaveBeenCalledWith(SCOPE);
    expect(storeMock.recordHeteroOverloadRetry).toHaveBeenCalledWith(SCOPE);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('aborts the scheduled retry when the wait op was cancelled (global Stop)', () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    // Simulate the wait op being cancelled out from under us mid-countdown.
    storeMock.isHeteroOverloadWaitAborted.mockReturnValue(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onRetry).not.toHaveBeenCalled();
    expect(storeMock.recordHeteroOverloadRetry).not.toHaveBeenCalled();
    expect(storeMock.markHeteroOverloadRetryExhausted).toHaveBeenCalledWith(SCOPE);
  });

  it('uses a longer backoff window as attempts accrue', () => {
    storeMock.attempts = { [SCOPE]: 1 };
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    // second attempt: 5s window, shown as attempt 2 / 5
    expect(result.current?.attempt).toBe(2);
    expect(result.current?.secondsLeft).toBe(5);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onRetry).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to manual (returns undefined) once the cap is reached', () => {
    storeMock.attempts = { [SCOPE]: 5 };
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    expect(result.current).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not schedule when disabled or without a scope', () => {
    const onRetry = vi.fn();
    const disabled = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: false,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );
    expect(disabled.result.current).toBeUndefined();

    const noScope = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: undefined,
      }),
    );
    expect(noScope.result.current).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('onRetryNow fires immediately and the scheduled timer cannot double-fire', () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    act(() => {
      result.current?.onRetryNow();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(storeMock.recordHeteroOverloadRetry).toHaveBeenCalledTimes(1);

    // The pending timer must not retry a second time.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('onCancel pins the counter past the cap, ends the wait, and blocks a queued timer', () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    act(() => {
      result.current?.onCancel();
    });
    expect(storeMock.markHeteroOverloadRetryExhausted).toHaveBeenCalledWith(SCOPE);
    expect(storeMock.internal_endHeteroOverloadWait).toHaveBeenCalledWith(SCOPE);

    // A timer callback that was already dequeued for this tick must not retry
    // after the user cancelled.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('cleans up the pending timer on unmount', () => {
    const onRetry = vi.fn();
    const { unmount } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        onRetry,
        messageId: 'failed-step',
        scopeId: SCOPE,
      }),
    );

    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });
  // ROOT CAUSE:
  // Persisted overloaded cards used their mount as permission to execute again.
  // Looking at an old branch or reloading reset the budget and reran shell steps.
  // A live local run now grants one claim; hydration and consumed claims grant none.
  /** @example Loading historical failure data never dispatches a native run. */
  it('keeps hydrated historical failures manual when there is no local run', () => {
    storeMock.hasOperation = false;
    const onRetry = vi.fn();
    const { result } = renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        messageId: 'failed-step',
        onRetry,
        scopeId: SCOPE,
      }),
    );
    act(() => vi.advanceTimersByTime(60_000));
    /** @example No countdown and no implicit retry for loaded history. */
    expect(result.current).toBeUndefined();
    expect(onRetry).not.toHaveBeenCalled();
  });

  /** @example Returning to an already retried branch cannot consume another attempt. */
  it('does not rearm the same failed run after navigating away and back', () => {
    const onRetry = vi.fn();
    const renderFailure = () =>
      renderHook(() =>
        useHeterogeneousAutoRetry({
          enabled: true,
          messageId: 'failed-step',
          onRetry,
          scopeId: SCOPE,
        }),
      );
    const first = renderFailure();
    act(() => vi.advanceTimersByTime(2000));
    first.unmount();
    const historical = renderFailure();
    act(() => vi.advanceTimersByTime(60_000));
    /** @example Only the original live error can schedule this run's retry. */
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(historical.result.current).toBeUndefined();
  });

  /** @example Stop followed directly by a fresh page load stays stopped. */
  it('does not restart a cancelled countdown after reload clears the local budget', () => {
    const onRetry = vi.fn();
    const renderFailure = () =>
      renderHook(() =>
        useHeterogeneousAutoRetry({
          enabled: true,
          messageId: 'failed-step',
          onRetry,
          scopeId: SCOPE,
        }),
      );
    const first = renderFailure();
    act(() => first.result.current?.onCancel());
    first.unmount();
    storeMock.attempts = {};
    storeMock.hasOperation = false;
    renderFailure();
    act(() => vi.advanceTimersByTime(60_000));
    /** @example Refreshing does not imply a Retry action. */
    expect(onRetry).not.toHaveBeenCalled();
  });

  /** @example Reconnecting an existing run only observes it, without retry permission. */
  it('keeps reconnected runs manual unless a new run granted retry permission', () => {
    storeMock.retryAvailable = false;
    const onRetry = vi.fn();
    renderHook(() =>
      useHeterogeneousAutoRetry({
        enabled: true,
        messageId: 'failed-step',
        onRetry,
        scopeId: SCOPE,
      }),
    );
    act(() => vi.advanceTimersByTime(60_000));
    /** @example A server operation id alone cannot authorize replay. */
    expect(onRetry).not.toHaveBeenCalled();
  });
});
