import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLIND_BOX_INTERVAL, useBlindBoxSeed } from './useBlindBoxSeed';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBlindBoxSeed', () => {
  it('changes the seed every interval while active', () => {
    const { result } = renderHook(() => useBlindBoxSeed(true));
    const first = result.current.seed;

    act(() => vi.advanceTimersByTime(BLIND_BOX_INTERVAL - 1));
    expect(result.current.seed).toBe(first);

    act(() => vi.advanceTimersByTime(1));
    const second = result.current.seed;
    expect(second).not.toBe(first);

    act(() => vi.advanceTimersByTime(BLIND_BOX_INTERVAL));
    expect(result.current.seed).not.toBe(second);
  });

  // The outgoing character stays mounted for the cross-fade.
  it('keeps the replaced seed as the previous one', () => {
    const { result } = renderHook(() => useBlindBoxSeed(true));
    const first = result.current.seed;
    expect(result.current.previousSeed).toBeUndefined();

    act(() => vi.advanceTimersByTime(BLIND_BOX_INTERVAL));

    expect(result.current.previousSeed).toBe(first);
  });

  it('holds still while inactive, e.g. once the user picked an avatar', () => {
    const { result, rerender } = renderHook(({ active }) => useBlindBoxSeed(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    const held = result.current;
    act(() => vi.advanceTimersByTime(BLIND_BOX_INTERVAL * 3));

    expect(result.current).toBe(held);
  });
});
