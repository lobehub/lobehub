/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppProcessMetrics } from './appProcessMetrics';

const getAppProcessMetricsMock = vi.fn();

vi.mock('@/services/electron/devtools', () => ({
  electronDevtoolsService: {
    getAppProcessMetrics: (...args: unknown[]) => getAppProcessMetricsMock(...args),
  },
}));

const SAMPLE = { cpuPercent: 12.5, gpu: { cpuPercent: 2, memoryMB: 64 } };

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useAppProcessMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAppProcessMetricsMock.mockReset();
    getAppProcessMetricsMock.mockResolvedValue(SAMPLE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should drop the priming sample and expose the second one', async () => {
    const { result, unmount } = renderHook(() => useAppProcessMetrics());

    await advance(0);
    expect(result.current).toBeNull();

    await advance(2000);
    expect(result.current).toEqual(SAMPLE);

    unmount();
  });

  it('should sample once for all readers, since cpu usage is relative to the previous call', async () => {
    const first = renderHook(() => useAppProcessMetrics());
    const second = renderHook(() => useAppProcessMetrics());

    await advance(4000);

    expect(getAppProcessMetricsMock).toHaveBeenCalledTimes(3);
    expect(first.result.current).toEqual(SAMPLE);
    expect(second.result.current).toEqual(SAMPLE);

    first.unmount();
    second.unmount();
  });

  it('should stop sampling once the last reader unmounts', async () => {
    const { unmount } = renderHook(() => useAppProcessMetrics());

    await advance(2000);
    unmount();
    getAppProcessMetricsMock.mockClear();

    await advance(6000);
    expect(getAppProcessMetricsMock).not.toHaveBeenCalled();
  });

  it('should keep readers hidden when the ipc bridge is missing', async () => {
    getAppProcessMetricsMock.mockRejectedValue(new Error('electronAPI.invoke not found'));
    const { result, unmount } = renderHook(() => useAppProcessMetrics());

    await advance(4000);
    expect(result.current).toBeNull();

    unmount();
  });
});
