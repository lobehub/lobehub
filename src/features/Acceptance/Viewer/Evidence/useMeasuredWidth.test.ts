import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeasuredWidth } from './useMeasuredWidth';

const observed = new Set<Element>();
let notify: (() => void) | undefined;

class FakeResizeObserver {
  constructor(callback: () => void) {
    notify = callback;
  }
  disconnect() {
    observed.clear();
  }
  observe(target: Element) {
    observed.add(target);
  }
  unobserve(target: Element) {
    observed.delete(target);
  }
}

const nodeOfWidth = (width: number) => {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientWidth', { configurable: true, value: width });
  return node;
};

beforeEach(() => {
  observed.clear();
  notify = undefined;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useMeasuredWidth', () => {
  it('re-measures when the observed node is replaced', () => {
    // The reject modal swaps this node on the responsive flip and on every
    // step between the image and the feedback screen. An observer bound to the
    // first node keeps reporting the old layout — which froze the phone viewer
    // at fit-width no matter what zoom said.
    const { result } = renderHook(() => useMeasuredWidth());

    act(() => result.current.ref(nodeOfWidth(360)));
    expect(result.current.width).toBe(360);

    act(() => result.current.ref(nodeOfWidth(750)));
    expect(result.current.width).toBe(750);
  });

  it('treats a zero width as unmeasured, then recovers once laid out', () => {
    // Measuring while the modal is still animating open yields 0. Reporting
    // that as a real width would multiply zoom by nothing forever.
    const node = nodeOfWidth(0);
    const { result } = renderHook(() => useMeasuredWidth());

    act(() => result.current.ref(node));
    expect(result.current.width).toBeUndefined();

    Object.defineProperty(node, 'clientWidth', { configurable: true, value: 640 });
    act(() => notify?.());
    expect(result.current.width).toBe(640);
  });

  it('stops observing the node it is detached from', () => {
    const { result, unmount } = renderHook(() => useMeasuredWidth());

    act(() => result.current.ref(nodeOfWidth(320)));
    expect(observed.size).toBe(1);

    unmount();
    expect(observed.size).toBe(0);
  });
});
