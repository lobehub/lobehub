import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoDismiss } from './useAutoDismiss';

const renderAutoDismiss = (onDismiss: () => void, key: string | null = '2.2.21') =>
  renderHook(({ key }) => useAutoDismiss(key, onDismiss, 3000), { initialProps: { key } });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoDismiss', () => {
  it('dismisses once the key has been shown for the full duration', () => {
    const onDismiss = vi.fn();
    renderAutoDismiss(onDismiss);

    vi.advanceTimersByTime(2999);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not count down while the key is nullish', () => {
    const onDismiss = vi.fn();
    renderAutoDismiss(onDismiss, null);

    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('restarts the countdown when the key changes', () => {
    const onDismiss = vi.fn();
    const { rerender } = renderAutoDismiss(onDismiss);

    vi.advanceTimersByTime(2000);
    rerender({ key: '2.2.22' });
    vi.advanceTimersByTime(2000);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('cancels the countdown when the key is cleared', () => {
    const onDismiss = vi.fn();
    const { rerender } = renderAutoDismiss(onDismiss);

    vi.advanceTimersByTime(2000);
    rerender({ key: null });
    vi.advanceTimersByTime(3000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('pauses while hovered and restarts the full duration on leave', () => {
    const onDismiss = vi.fn();
    const { result } = renderAutoDismiss(onDismiss);

    vi.advanceTimersByTime(2000);
    act(() => result.current.onMouseEnter());
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => result.current.onMouseLeave());
    vi.advanceTimersByTime(2999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not keep a new key paused when the hovered toast was replaced', () => {
    const onDismiss = vi.fn();
    const { result, rerender } = renderAutoDismiss(onDismiss);

    act(() => result.current.onMouseEnter());
    rerender({ key: null });
    rerender({ key: '2.2.22' });

    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
