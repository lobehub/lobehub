/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FALLBACK_DELAY, useDelayedVisible } from './Delayed';
import { HANDOVER_WINDOW, isSkeletonHandover } from './skeletonHandover';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDelayedVisible', () => {
  it('counts as a visible skeleton for the next boundary while it is shown', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useDelayedVisible());

    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(FALLBACK_DELAY);
    });
    expect(result.current).toBe(true);
    expect(isSkeletonHandover(performance.now() + HANDOVER_WINDOW * 10)).toBe(true);

    unmount();
    expect(isSkeletonHandover(performance.now() + HANDOVER_WINDOW * 10)).toBe(false);
  });
});
