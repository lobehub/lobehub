import type { VideoPlayer } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useVideoRegionGesture } from './useVideoRegionGesture';

describe('video region gesture', () => {
  const setup = () => {
    const clock = {
      getState: vi.fn(() => ({ paused: false, time: 2.25 })),
      pause: vi.fn(),
      toggle: vi.fn(),
    } as unknown as VideoPlayer;
    const onRegion = vi.fn();
    const element = document.createElement('div');
    element.setPointerCapture = vi.fn();
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    const hook = renderHook(() => useVideoRegionGesture(clock, onRegion));
    act(() =>
      hook.result.current.onPointerDown({
        currentTarget: element,
        pointerId: 1,
        clientX: 20,
        clientY: 10,
      } as ReactPointerEvent<HTMLDivElement>),
    );
    return { clock, onRegion, element, hook };
  };

  it('pins the region to the displayed frame at pointer-down, not the later playhead', () => {
    const { clock, onRegion, element } = setup();
    vi.mocked(clock.getState).mockReturnValue({ ...clock.getState(), time: 3 });
    act(() => {
      element.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 60 }));
      element.dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(onRegion).toHaveBeenCalledWith({
      rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      time: { start: 2.25 },
    });
  });

  it('cancels an interrupted gesture without publishing a selection', () => {
    const { onRegion, element, hook } = setup();
    act(() => {
      element.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 60 }));
      element.dispatchEvent(new PointerEvent('pointercancel'));
      element.dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(onRegion).not.toHaveBeenCalled();
    expect(hook.result.current.draft).toBeNull();
  });
});
