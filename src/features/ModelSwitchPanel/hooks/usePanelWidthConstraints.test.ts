import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_WIDTH, MIN_WIDTH } from '../const';
import { usePanelWidthConstraints } from './usePanelWidthConstraints';

let resizeCallback: ResizeObserverCallback;
const disconnect = vi.fn();
const observe = vi.fn();

beforeEach(() => {
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('usePanelWidthConstraints', () => {
  it('keeps react-rnd constraints numeric while following the available popup width', () => {
    const { result, unmount } = renderHook(() => usePanelWidthConstraints(550));
    let measuredWidth = 240;
    const probe = {
      get clientWidth() {
        return measuredWidth;
      },
    } as HTMLDivElement;

    act(() => result.current.probeRef(probe));

    expect(result.current).toMatchObject({
      constrainedWidth: 240,
      maxWidth: 240,
      minWidth: 240,
    });
    expect(observe).toHaveBeenCalledWith(probe);

    measuredWidth = 450;
    act(() => resizeCallback([], {} as ResizeObserver));

    expect(result.current).toMatchObject({
      constrainedWidth: 450,
      maxWidth: 450,
      minWidth: MIN_WIDTH,
    });

    measuredWidth = 700;
    act(() => resizeCallback([], {} as ResizeObserver));

    expect(result.current).toMatchObject({
      constrainedWidth: 550,
      maxWidth: MAX_WIDTH,
      minWidth: MIN_WIDTH,
    });

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
