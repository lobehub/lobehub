import { describe, expect, it, vi } from 'vitest';

import { type AnnotationShape, drawShapes, isMeaningfulShape, rectFromPoints } from './shapes';

const createCtx = () => ({
  beginPath: vi.fn(),
  lineCap: 'butt',
  lineJoin: 'miter',
  lineTo: vi.fn(),
  lineWidth: 1,
  moveTo: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  strokeStyle: '',
});

describe('annotation shapes', () => {
  it('builds a rect from any drag direction', () => {
    expect(rectFromPoints({ x: 0.8, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({
      height: 0.5,
      width: expect.closeTo(0.6),
      x: 0.2,
      y: 0.1,
    });
  });

  it('drops clicks that would export as nothing', () => {
    expect(
      isMeaningfulShape({ color: '#f00', points: [{ x: 0, y: 0 }], size: 0.01, type: 'brush' }),
    ).toBe(false);
    expect(
      isMeaningfulShape({
        color: '#f00',
        rect: { height: 0, width: 0.3, x: 0, y: 0 },
        size: 0.01,
        type: 'rect',
      }),
    ).toBe(false);
  });

  it('draws normalized shapes in canvas pixels', () => {
    const ctx = createCtx();
    const shapes: AnnotationShape[] = [
      {
        color: '#ff0000',
        rect: { height: 0.5, width: 0.25, x: 0.1, y: 0.2 },
        size: 0.01,
        type: 'rect',
      },
      {
        color: '#00ff00',
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
        ],
        size: 0.02,
        type: 'brush',
      },
    ];

    drawShapes(ctx as never, shapes, 400, 200);

    expect(ctx.strokeRect).toHaveBeenCalledWith(40, 40, 100, 100);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(200, 100);
    // Stroke width scales with the shorter side: 0.02 × 200.
    expect(ctx.lineWidth).toBe(4);
    expect(ctx.strokeStyle).toBe('#00ff00');
  });
});
