import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HINT_DELAY, resetHintClock } from './hintClock';
import { useLoadingHint } from './useLoadingHint';

const elapse = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  resetHintClock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLoadingHint', () => {
  it('stays quiet through a normal wait and fades in once the delay elapses', () => {
    const { result } = renderHook(() => useLoadingHint());

    elapse(HINT_DELAY - 1);
    expect(result.current).toBeUndefined();

    elapse(1);
    expect(result.current).toBe('enter');
  });

  it('continues the wait when the layout fallback takes over from the boot shell', () => {
    const boot = renderHook(() => useLoadingHint());

    elapse(HINT_DELAY - 500);
    boot.unmount();
    const fallback = renderHook(() => useLoadingHint());

    elapse(499);
    expect(fallback.result.current).toBeUndefined();
    elapse(1);
    expect(fallback.result.current).toBe('enter');
  });

  it('continues the wait for a fallback that mounts while the boot shell is still up', () => {
    renderHook(() => useLoadingHint());

    elapse(HINT_DELAY - 500);
    const fallback = renderHook(() => useLoadingHint());

    elapse(500);
    expect(fallback.result.current).toBe('enter');
  });

  it('keeps an already-shown hint on screen across the handoff without replaying it', () => {
    const boot = renderHook(() => useLoadingHint());

    elapse(HINT_DELAY);
    boot.unmount();
    const fallback = renderHook(() => useLoadingHint());

    expect(fallback.result.current).toBe('static');
  });

  it('starts a fresh wait for a shell that mounts well after the last one left', () => {
    const first = renderHook(() => useLoadingHint());
    elapse(HINT_DELAY);
    first.unmount();

    elapse(5000);
    const next = renderHook(() => useLoadingHint());

    expect(next.result.current).toBeUndefined();
    elapse(HINT_DELAY);
    expect(next.result.current).toBe('enter');
  });
});
