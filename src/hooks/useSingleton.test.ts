import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSingleton } from './useSingleton';

describe('useSingleton', () => {
  it('should call factory only once across re-renders', () => {
    const factory = vi.fn(() => ({ id: Math.random() }));

    const { result, rerender } = renderHook(() => useSingleton(factory));

    expect(factory).toHaveBeenCalledTimes(1);
    const first = result.current;

    rerender();
    rerender();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(first);
  });

  it('should support undefined factory results', () => {
    const factory = vi.fn(() => undefined as undefined);

    const { result, rerender } = renderHook(() => useSingleton(factory));

    expect(result.current).toBeUndefined();
    rerender();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should create independent instances per hook call', () => {
    const { result } = renderHook(() => ({
      a: useSingleton(() => new Map<string, number>()),
      b: useSingleton(() => new Map<string, number>()),
    }));

    expect(result.current.a).not.toBe(result.current.b);
    result.current.a.set('x', 1);
    expect(result.current.b.has('x')).toBe(false);
  });
});
