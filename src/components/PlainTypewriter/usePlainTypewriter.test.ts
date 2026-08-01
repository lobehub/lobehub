import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlainTypewriter } from './usePlainTypewriter';

describe('usePlainTypewriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grows a contiguous Persian prefix so glyphs can join while typing', async () => {
    const { result } = renderHook(() =>
      usePlainTypewriter({ pauseDuration: 60_000, sentences: ['کنم'], typingSpeed: 10 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.displayedText).toBe('ک');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.displayedText).toBe('کن');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.displayedText).toBe('کنم');
  });

  it('hides the cursor after typing when configured', async () => {
    const { result } = renderHook(() =>
      usePlainTypewriter({
        hideCursorWhileTyping: 'afterTyping',
        pauseDuration: 60_000,
        sentences: ['ab'],
        typingSpeed: 10,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.showCursor).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.showCursor).toBe(false);
  });
});
