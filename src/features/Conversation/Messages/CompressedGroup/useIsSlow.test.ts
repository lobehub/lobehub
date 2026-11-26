/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SLOW_AFTER_MS, useIsSlow } from './useIsSlow';

describe('useIsSlow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns on after the threshold and off once the work stops', () => {
    const { rerender, result } = renderHook(({ running }) => useIsSlow(running), {
      initialProps: { running: true },
    });
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS));
    expect(result.current).toBe(true);

    rerender({ running: false });
    expect(result.current).toBe(false);
  });
});
