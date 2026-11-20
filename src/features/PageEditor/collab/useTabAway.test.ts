import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AWAY_AFTER_MS, useTabAway } from './useTabAway';

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useTabAway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it('turns away only after the tab stays hidden for the whole window', () => {
    const { result } = renderHook(() => useTabAway());

    act(() => setHidden(true));
    act(() => vi.advanceTimersByTime(AWAY_AFTER_MS - 1));
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('comes back as soon as the tab is visible again', () => {
    const { result } = renderHook(() => useTabAway());

    act(() => setHidden(true));
    act(() => vi.advanceTimersByTime(AWAY_AFTER_MS));
    act(() => setHidden(false));

    expect(result.current).toBe(false);
  });

  it('does not turn away when the tab comes back before the window ends', () => {
    const { result } = renderHook(() => useTabAway());

    act(() => setHidden(true));
    act(() => vi.advanceTimersByTime(AWAY_AFTER_MS / 2));
    act(() => setHidden(false));
    act(() => vi.advanceTimersByTime(AWAY_AFTER_MS));

    expect(result.current).toBe(false);
  });
});
