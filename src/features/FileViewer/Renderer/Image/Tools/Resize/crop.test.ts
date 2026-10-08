import { describe, expect, it } from 'vitest';

import {
  aspectRatioOf,
  centeredCrop,
  cropPixelSize,
  dragCrop,
  MAX_OUTPUT_EDGE,
  resolveOutputSize,
} from './crop';

const natural = { height: 1000, width: 2000 };

describe('aspect presets', () => {
  it('resolves preset ratios', () => {
    expect(aspectRatioOf('free', natural)).toBeUndefined();
    expect(aspectRatioOf('original', natural)).toBe(2);
    expect(aspectRatioOf('16:9', natural)).toBeCloseTo(16 / 9);
  });

  it('centers the largest crop for a ratio', () => {
    // A square out of a 2:1 image is the middle half horizontally.
    expect(centeredCrop(natural, 1)).toEqual({ height: 1, width: 0.5, x: 0.25, y: 0 });
    // A 4:1 strip out of a 2:1 image is the middle half vertically.
    expect(centeredCrop(natural, 4)).toEqual({ height: 0.5, width: 1, x: 0, y: 0.25 });
    expect(centeredCrop(natural, undefined)).toEqual({ height: 1, width: 1, x: 0, y: 0 });
  });
});

describe('dragCrop', () => {
  const start = { height: 0.5, width: 0.5, x: 0.25, y: 0.25 };

  it('moves the crop and keeps it inside the image', () => {
    expect(dragCrop(start, 'move', { x: 0.1, y: -0.1 }, natural)).toEqual({
      height: 0.5,
      width: 0.5,
      x: 0.35,
      y: 0.15,
    });
    expect(dragCrop(start, 'move', { x: 1, y: 1 }, natural)).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('resizes from a corner against the opposite corner', () => {
    const next = dragCrop(start, 'nw', { x: -0.1, y: -0.1 }, natural);
    expect(next.x).toBeCloseTo(0.15);
    expect(next.y).toBeCloseTo(0.15);
    expect(next.width).toBeCloseTo(0.6);
    expect(next.height).toBeCloseTo(0.6);
  });

  it('keeps a locked pixel aspect while resizing', () => {
    const next = dragCrop(start, 'se', { x: 0.1, y: 0 }, natural, 1);
    const px = cropPixelSize(next, natural);
    expect(px.width).toBe(px.height);
  });

  it('never grows past the image edge', () => {
    const next = dragCrop(start, 'se', { x: 5, y: 5 }, natural);
    expect(next.x + next.width).toBeLessThanOrEqual(1);
    expect(next.y + next.height).toBeLessThanOrEqual(1);
  });
});

describe('resolveOutputSize', () => {
  const crop = { height: 500, width: 1000 };

  it('derives the other side from the edited one when locked', () => {
    expect(resolveOutputSize(crop, { edited: 'width', height: 0, width: 400 }, true)).toEqual({
      height: 200,
      width: 400,
    });
    expect(resolveOutputSize(crop, { edited: 'height', height: 300, width: 0 }, true)).toEqual({
      height: 300,
      width: 600,
    });
  });

  it('accepts both sides when unlocked and clamps to safe bounds', () => {
    expect(resolveOutputSize(crop, { edited: 'width', height: 10, width: 99_999 }, false)).toEqual({
      height: 10,
      width: MAX_OUTPUT_EDGE,
    });
  });
});

describe('cropPixelSize', () => {
  it('is the crop at natural resolution', () => {
    expect(
      cropPixelSize({ height: 0.5, width: 0.5, x: 0, y: 0 }, { height: 1000, width: 2000 }),
    ).toEqual({ height: 500, width: 1000 });
  });

  // Regression: a huge source started the output above the cap, so Save
  // allocated a canvas the browser could refuse.
  it('scales a crop larger than the output cap down to it, keeping the ratio', () => {
    expect(
      cropPixelSize({ height: 1, width: 1, x: 0, y: 0 }, { height: 10_000, width: 20_000 }),
    ).toEqual({ height: MAX_OUTPUT_EDGE / 2, width: MAX_OUTPUT_EDGE });
  });
});

describe('dragCrop with a locked aspect', () => {
  const natural = { height: 1000, width: 1000 };
  const start = { height: 0.5, width: 0.5, x: 0, y: 0 };

  // Regression: a vertical drag on a corner did nothing once the ratio was locked.
  it('follows a vertical corner drag', () => {
    const next = dragCrop(start, 'se', { x: 0, y: 0.2 }, natural, 1);
    expect(next.height).toBeCloseTo(0.7);
    expect(next.width).toBeCloseTo(0.7);
  });

  it('follows a horizontal corner drag', () => {
    const next = dragCrop(start, 'se', { x: -0.2, y: 0 }, natural, 1);
    expect(next.width).toBeCloseTo(0.3);
    expect(next.height).toBeCloseTo(0.3);
  });
});

describe('resolveOutputSize at the cap', () => {
  // Regression: a locked 2:1 crop at height 8192 clamped to 8192x8192.
  it('scales both edges together so the locked ratio survives', () => {
    expect(
      resolveOutputSize(
        { height: 500, width: 1000 },
        { edited: 'height', height: MAX_OUTPUT_EDGE, width: 0 },
        true,
      ),
    ).toEqual({ height: MAX_OUTPUT_EDGE / 2, width: MAX_OUTPUT_EDGE });
  });
});
