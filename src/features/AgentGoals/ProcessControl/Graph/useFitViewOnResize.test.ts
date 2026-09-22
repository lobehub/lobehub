import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observeWidth } from './useFitViewOnResize';

let resizeCallback: ResizeObserverCallback;
const disconnect = vi.fn();
const observe = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      disconnect = disconnect;
      observe = observe;
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('observeWidth', () => {
  it('reframes once after an animated panel width change settles', () => {
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      bottom: 0,
      height: 560,
      left: 0,
      right: 1000,
      toJSON: vi.fn(),
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
    });
    const reframe = vi.fn();
    const cleanup = observeWidth(element, reframe);

    for (const width of [900, 800, 700]) {
      resizeCallback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
      vi.advanceTimersByTime(50);
    }

    expect(reframe).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(reframe).toHaveBeenCalledOnce();

    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('ignores height-only resize notifications', () => {
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      bottom: 0,
      height: 560,
      left: 0,
      right: 1000,
      toJSON: vi.fn(),
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
    });
    const reframe = vi.fn();
    const cleanup = observeWidth(element, reframe);

    resizeCallback(
      [{ contentRect: { height: 400, width: 1000 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    vi.runAllTimers();

    expect(reframe).not.toHaveBeenCalled();
    cleanup();
  });
});
