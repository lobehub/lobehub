import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBrokenSrc } from './useBrokenSrc';

describe('useBrokenSrc', () => {
  it('starts unbroken', () => {
    const { result } = renderHook(() => useBrokenSrc('https://example.com/a.png'));

    expect(result.current[0]).toBe(false);
  });

  it('remembers a failure for the same url', () => {
    const { rerender, result } = renderHook(({ src }) => useBrokenSrc(src), {
      initialProps: { src: 'https://example.com/a.png' },
    });

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);

    rerender({ src: 'https://example.com/a.png' });
    expect(result.current[0]).toBe(true);
  });

  it('retries a new url', () => {
    const { rerender, result } = renderHook(({ src }) => useBrokenSrc(src), {
      initialProps: { src: 'https://example.com/a.png' },
    });

    act(() => result.current[1]());
    rerender({ src: 'https://example.com/b.png' });

    expect(result.current[0]).toBe(false);
  });

  it('retries the original url after it comes back — a repaired upload keeps its url', () => {
    const { rerender, result } = renderHook(({ src }) => useBrokenSrc(src), {
      initialProps: { src: 'https://example.com/a.png' },
    });

    act(() => result.current[1]());
    rerender({ src: 'https://example.com/b.png' });
    rerender({ src: 'https://example.com/a.png' });

    expect(result.current[0]).toBe(false);
  });

  it('is never broken without a url', () => {
    const { result } = renderHook(() => useBrokenSrc(undefined));

    expect(result.current[0]).toBe(false);
  });
});
