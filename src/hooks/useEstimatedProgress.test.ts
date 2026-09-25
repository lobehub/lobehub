/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_ESTIMATED_PROGRESS, useEstimatedProgress } from './useEstimatedProgress';

describe('useEstimatedProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null without a positive duration or when disabled', () => {
    const { result: noDuration } = renderHook(() => useEstimatedProgress({ durationMs: 0 }));
    const { result: disabled } = renderHook(() =>
      useEstimatedProgress({ durationMs: 10_000, enabled: false }),
    );

    expect(noDuration.current).toBeNull();
    expect(disabled.current).toBeNull();
  });

  it('advances with elapsed time and caps below completion', () => {
    const { result } = renderHook(() => useEstimatedProgress({ durationMs: 10_000 }));
    expect(result.current).toBe(0);

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(50);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(MAX_ESTIMATED_PROGRESS);
  });

  it('resumes from the start time stored under the storage key', () => {
    sessionStorage.setItem('progress-key', String(100_000 - 4000));

    const { result } = renderHook(() =>
      useEstimatedProgress({ durationMs: 10_000, storageKey: 'progress-key' }),
    );

    expect(result.current).toBe(40);
  });

  it('stores the start time when none is recorded yet', () => {
    renderHook(() => useEstimatedProgress({ durationMs: 10_000, storageKey: 'progress-key' }));

    expect(sessionStorage.getItem('progress-key')).toBe('100000');
  });
});
