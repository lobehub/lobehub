import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useNaturalHeight } from './useNaturalHeight';

type ObserverEntry = { contentRect: { height: number; width: number } };

let notify: ((entries: ObserverEntry[]) => void) | undefined;
let observed = 0;
let disconnected = 0;

const originalResizeObserver = globalThis.ResizeObserver;

const elementWithScrollHeight = (initial: number) => {
  const el = { scrollHeight: initial };
  return { el, ref: { current: el as unknown as HTMLElement } as RefObject<HTMLElement | null> };
};

beforeEach(() => {
  notify = undefined;
  observed = 0;
  disconnected = 0;
  globalThis.ResizeObserver = class {
    constructor(cb: (entries: ObserverEntry[]) => void) {
      notify = cb;
    }
    disconnect() {
      disconnected += 1;
    }
    observe() {
      observed += 1;
    }
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('useNaturalHeight', () => {
  it('measures the element on mount and observes it', () => {
    const { ref } = elementWithScrollHeight(900);

    const { result } = renderHook(() => useNaturalHeight(ref));

    expect(result.current).toBe(900);
    expect(observed).toBe(1);
  });

  it('ignores a zero box so a hidden subtree keeps its last real height', () => {
    const { el, ref } = elementWithScrollHeight(900);
    const { result } = renderHook(() => useNaturalHeight(ref));

    // An inactive desktop tab kept alive behind `display: none` reports a zero
    // box and a zero scrollHeight.
    el.scrollHeight = 0;
    act(() => {
      notify?.([{ contentRect: { height: 0, width: 0 } }]);
    });

    expect(result.current).toBe(900);
  });

  it('re-measures on a real size change', () => {
    const { el, ref } = elementWithScrollHeight(900);
    const { result } = renderHook(() => useNaturalHeight(ref));

    el.scrollHeight = 120;
    act(() => {
      notify?.([{ contentRect: { height: 120, width: 600 } }]);
    });

    expect(result.current).toBe(120);
  });

  it('disconnects the observer on unmount', () => {
    const { ref } = elementWithScrollHeight(400);
    const { unmount } = renderHook(() => useNaturalHeight(ref));

    unmount();

    expect(disconnected).toBe(1);
  });
});
