import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalyzeCountdown } from './useAnalyzeCountdown';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => {
  vi.useRealTimers();
});

/** @example An expired countdown stops ticking while the backend is still delayed. */
describe('useAnalyzeCountdown', () => {
  it('stops the countdown clock at the deadline', () => {
    // ROOT CAUSE:
    // The countdown cleared its interval only when dueAt changed or it unmounted.
    // An unchanged expired deadline kept scheduling renders ten times per second.
    // Stop the interval on the tick that reaches the deadline.
    let renders = 0;
    const view = renderHook(() => {
      renders += 1;
      return useAnalyzeCountdown(11_000);
    });

    /** @example The countdown is initially visible. */
    expect(view.result.current).toBe(1000);

    act(() => vi.advanceTimersByTime(500));
    /** @example The remaining time follows the clock. */
    expect(view.result.current).toBe(500);

    act(() => vi.advanceTimersByTime(500));
    /** @example The countdown returns to idle at expiry. */
    expect(view.result.current).toBe(0);
    /** @example No interval stays scheduled after the deadline. */
    expect(vi.getTimerCount()).toBe(0);

    const rendersAtExpiry = renders;
    act(() => vi.advanceTimersByTime(5000));
    /** @example A delayed server response does not keep the expired clock rendering. */
    expect(renders).toBe(rendersAtExpiry);
  });

  it('stays idle without a future deadline', () => {
    const { result } = renderHook(({ dueAt }) => useAnalyzeCountdown(dueAt), {
      initialProps: { dueAt: undefined as number | undefined },
    });

    /** @example Nothing scheduled reports no remaining time. */
    expect(result.current).toBe(0);
    /** @example No clock runs without a deadline. */
    expect(vi.getTimerCount()).toBe(0);
  });
});
