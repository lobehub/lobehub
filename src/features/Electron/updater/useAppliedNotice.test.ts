import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APPLIED_NOTICE_DURATION, useAppliedNotice } from './useAppliedNotice';

const dismissAppliedNotice = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/services/electron/rendererOta', () => ({
  rendererOtaService: { dismissAppliedNotice },
}));

const VERSION = '2.3.5-canary.1-core.87';

beforeEach(() => {
  vi.useFakeTimers();
  dismissAppliedNotice.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAppliedNotice', () => {
  it('clears the main-process notice when the toast times out, so a remount does not show it again', () => {
    const { result } = renderHook(() => useAppliedNotice(false));
    act(() => result.current.setAppliedVersion(VERSION));

    act(() => vi.advanceTimersByTime(APPLIED_NOTICE_DURATION));

    expect(result.current.appliedVersion).toBeNull();
    expect(dismissAppliedNotice).toHaveBeenCalledTimes(1);
  });

  it('clears the main-process notice when ignored', () => {
    const { result } = renderHook(() => useAppliedNotice(false));
    act(() => result.current.setAppliedVersion(VERSION));

    act(() => result.current.dismiss());

    expect(result.current.appliedVersion).toBeNull();
    expect(dismissAppliedNotice).toHaveBeenCalledTimes(1);
  });

  it('keeps the notice while a pending update holds the toast slot', () => {
    const { result } = renderHook(() => useAppliedNotice(true));
    act(() => result.current.setAppliedVersion(VERSION));

    act(() => vi.advanceTimersByTime(APPLIED_NOTICE_DURATION * 2));

    expect(result.current.appliedVersion).toBe(VERSION);
    expect(dismissAppliedNotice).not.toHaveBeenCalled();
  });
});
