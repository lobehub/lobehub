/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationGesture } from './useAnnotationGesture';

const pointer = (x: number, y: number) =>
  ({
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType: 'touch',
    currentTarget: { setPointerCapture: vi.fn() },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as PointerEvent<HTMLDivElement>;

const setup = (drawing = true, width = 200, height = 400) => {
  const onDraw = vi.fn();
  const onUpdate = vi.fn();
  const hook = renderHook(() => useAnnotationGesture({ drawing, onDraw, onUpdate }));
  const image = document.createElement('img');
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    width,
    height,
    right: 10 + width,
    bottom: 20 + height,
    toJSON: () => ({}),
  });
  hook.result.current.imageRef.current = image;
  return { ...hook, onDraw, onUpdate };
};

describe('touch annotation gestures', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [360, 12000],
    [12000, 360],
    [6400, 3600],
  ])('keeps small visible regions on a %s × %s displayed image', (width, height) => {
    const { result, onDraw } = setup(true, width, height);
    act(() => result.current.handlers.onPointerDown(pointer(30, 40)));
    act(() => result.current.handlers.onPointerUp(pointer(34, 44)));
    expect(onDraw).toHaveBeenCalledOnce();
    const rect = onDraw.mock.calls[0][0];
    expect(rect.width * width).toBeCloseTo(4);
    expect(rect.height * height).toBeCloseTo(4);
  });

  it.each([
    [0, 0],
    [2, 2],
    [2, 20],
    [20, 2],
  ])('ignores a click or a region with a sub-threshold screen dimension (%s, %s)', (dx, dy) => {
    const { result, onDraw } = setup(true, 100, 100);
    act(() => result.current.handlers.onPointerDown(pointer(30, 40)));
    act(() => result.current.handlers.onPointerUp(pointer(30 + dx, 40 + dy)));
    expect(onDraw).not.toHaveBeenCalled();
  });

  it('resizes to a fixed screen minimum on a zoomed image', () => {
    const { result, onUpdate } = setup(true, 6400, 3600);
    const origin = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    act(() => result.current.startEdit(pointer(1930, 1100), 0, origin, 'resize'));
    act(() => result.current.handlers.onPointerMove(pointer(651, 381)));
    const rect = onUpdate.mock.calls[0][1];
    expect(rect.width * 6400).toBeCloseTo(3);
    expect(rect.height * 3600).toBeCloseTo(3);
  });

  it('keeps the resize minimum inside the image boundary', () => {
    const { result, onUpdate } = setup(true, 200, 400);
    const origin = { x: 0.995, y: 0.9975, width: 0.005, height: 0.0025 };
    act(() => result.current.startEdit(pointer(210, 420), 0, origin, 'resize'));
    act(() => result.current.handlers.onPointerMove(pointer(209, 419)));
    const rect = onUpdate.mock.calls[0][1];
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
  });

  it('captures touch and commits a normalized region on pointer up', () => {
    const { result, onDraw } = setup();
    const start = pointer(30, 60);
    act(() => result.current.handlers.onPointerDown(start));
    act(() => result.current.handlers.onPointerMove(pointer(110, 220)));
    expect(start.currentTarget.setPointerCapture).toHaveBeenCalledWith(7);
    expect(result.current.draft).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
    act(() => result.current.handlers.onPointerUp(pointer(110, 220)));
    expect(onDraw).toHaveBeenCalledWith({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
    expect(result.current.draft).toBeNull();
  });
  it('does not turn a cancelled touch into a region', () => {
    const { result, onDraw } = setup();
    act(() => result.current.handlers.onPointerDown(pointer(30, 60)));
    act(() => result.current.handlers.onPointerCancel());
    act(() => result.current.handlers.onPointerUp(pointer(110, 220)));
    expect(onDraw).not.toHaveBeenCalled();
  });
  it('lets browsing gestures scroll without drawing or capturing them', () => {
    const { result, onDraw } = setup(false);
    const start = pointer(30, 60);
    act(() => result.current.handlers.onPointerDown(start));
    act(() => result.current.handlers.onPointerUp(pointer(110, 220)));
    expect(start.preventDefault).not.toHaveBeenCalled();
    expect(start.currentTarget.setPointerCapture).not.toHaveBeenCalled();
    expect(onDraw).not.toHaveBeenCalled();
  });
});
