import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileUploadStatus } from '@/types/files/upload';

import { useUploadCompletion } from './useUploadCompletion';

describe('useUploadCompletion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('acknowledges success for two seconds, then returns to the compact chip', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: FileUploadStatus }) => useUploadCompletion(status),
      { initialProps: { status: 'uploading' as FileUploadStatus } },
    );
    expect(result.current).toBe(false);
    rerender({ status: 'processing' });
    expect(result.current).toBe(false);
    rerender({ status: 'success' });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1999));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('does not acknowledge already completed attachments on mount', () => {
    const { result } = renderHook(() => useUploadCompletion('success'));
    expect(result.current).toBe(false);
  });

  it('clears completion feedback when a new upload starts and cancels timers on unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ status }: { status: FileUploadStatus }) => useUploadCompletion(status),
      { initialProps: { status: 'uploading' as FileUploadStatus } },
    );
    rerender({ status: 'success' });
    rerender({ status: 'uploading' });
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ status: 'success' });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
