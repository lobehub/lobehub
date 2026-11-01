/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_HISTORY, useMemorySamples } from './memorySamples';

const getRendererMemoryInfo = vi.fn();

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useMemorySamples', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getRendererMemoryInfo.mockReset();
    getRendererMemoryInfo.mockResolvedValue({ privateBytes: 1024, sharedBytes: 0 });
    Object.assign(performance, { memory: { jsHeapSizeLimit: 4096, usedJSHeapSize: 512 } });
    Object.assign(window, { electronAPI: { getRendererMemoryInfo } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should keep a capped history across subscribers', async () => {
    const { result, unmount } = renderHook(() => useMemorySamples());

    await advance(0);
    expect(result.current?.latest).toMatchObject({
      jsHeapUsedBytes: 512,
      renderer: { privateBytes: 1024 },
    });

    await advance(2000 * (MAX_HISTORY + 10));
    expect(result.current?.history).toHaveLength(MAX_HISTORY);

    const second = renderHook(() => useMemorySamples());
    expect(second.result.current?.history).toHaveLength(MAX_HISTORY);

    unmount();
    second.unmount();
  });

  it('should fall back to the JS heap when the electron bridge is missing', async () => {
    Object.assign(window, { electronAPI: undefined });
    const { result, unmount } = renderHook(() => useMemorySamples());

    await advance(0);
    expect(result.current?.latest.renderer).toBeNull();
    expect(result.current?.latest.jsHeapLimitBytes).toBe(4096);

    unmount();
  });
});
