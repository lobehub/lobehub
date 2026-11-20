import { describe, expect, it } from 'vitest';

import {
  buildDerivedFileMetadata,
  buildDerivedFileName,
  clampZoom,
  clientToImagePoint,
  fitSize,
  imagePointToScreenFraction,
  MAX_ZOOM,
  MIN_ZOOM,
  nextRotation,
  zoomIn,
  zoomOut,
} from './geometry';

describe('zoom helpers', () => {
  it('steps and clamps zoom', () => {
    expect(zoomIn(1)).toBeCloseTo(1.25);
    expect(zoomOut(1)).toBeCloseTo(0.8);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it('cycles rotation in quarter turns', () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(270)).toBe(0);
  });
});

describe('fitSize', () => {
  it('fits a wide image into the container keeping its aspect', () => {
    expect(fitSize({ height: 1000, width: 2000 }, { height: 500, width: 500 })).toEqual({
      height: 250,
      width: 500,
    });
  });

  it('never upscales a small image at fit', () => {
    expect(fitSize({ height: 100, width: 200 }, { height: 800, width: 800 })).toEqual({
      height: 100,
      width: 200,
    });
  });

  it('fits the swapped footprint for a quarter turn', () => {
    // 2000×1000 rotated stands 1000 wide and 2000 tall in a 500×500 box → scale 0.25.
    expect(fitSize({ height: 1000, width: 2000 }, { height: 500, width: 500 }, 90)).toEqual({
      height: 250,
      width: 500,
    });
  });

  it('returns zero size before measurements exist', () => {
    expect(fitSize({ height: 0, width: 0 }, { height: 500, width: 500 })).toEqual({
      height: 0,
      width: 0,
    });
  });
});

describe('clientToImagePoint', () => {
  // A 200×100 image box drawn at (100, 100).
  const rect = { height: 100, left: 100, top: 100, width: 200 };

  it('normalizes a pointer against the unrotated box', () => {
    expect(clientToImagePoint({ x: 150, y: 125 }, rect)).toEqual({ x: 0.25, y: 0.25 });
  });

  it('clamps points outside the image', () => {
    expect(clientToImagePoint({ x: 0, y: 500 }, rect)).toEqual({ x: 0, y: 1 });
  });

  it('undoes a 90° clockwise turn', () => {
    // The 200×100 image turned 90° occupies a 100×200 box. Its top-left corner
    // (0,0) is now at the box's top-right.
    const rotated = { height: 200, left: 150, top: 50, width: 100 };
    const topLeft = clientToImagePoint({ x: 250, y: 50 }, rotated, 90);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
    const bottomRight = clientToImagePoint({ x: 150, y: 250 }, rotated, 90);
    expect(bottomRight.x).toBeCloseTo(1);
    expect(bottomRight.y).toBeCloseTo(1);
  });

  it('undoes 180° and 270° turns', () => {
    const half = clientToImagePoint({ x: 300, y: 200 }, rect, 180);
    expect(half.x).toBeCloseTo(0);
    expect(half.y).toBeCloseTo(0);

    const rotated = { height: 200, left: 150, top: 50, width: 100 };
    // After 270° the image's top-left corner sits at the box's bottom-left.
    const topLeft = clientToImagePoint({ x: 150, y: 250 }, rotated, 270);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
  });
});

describe('derived file helpers', () => {
  it('names derived images after the original', () => {
    expect(buildDerivedFileName('sunset.jpeg', 'annotated')).toBe('sunset-annotated.png');
    expect(buildDerivedFileName('archive.v2.webp', 'resized')).toBe('archive.v2-resized.png');
    expect(buildDerivedFileName(undefined, 'resized')).toBe('image-resized.png');
  });

  it('records lineage without touching the source', () => {
    expect(buildDerivedFileMetadata('file_1', 'resize')).toEqual({
      derivedFrom: { fileId: 'file_1', operation: 'resize' },
    });
  });
});

describe('imagePointToScreenFraction', () => {
  it('follows the image corner around each quarter turn', () => {
    const topLeft = { x: 0, y: 0 };
    expect(imagePointToScreenFraction(topLeft, 0)).toEqual({ x: 0, y: 0 });
    expect(imagePointToScreenFraction(topLeft, 90)).toEqual({ x: 1, y: 0 });
    expect(imagePointToScreenFraction(topLeft, 180)).toEqual({ x: 1, y: 1 });
    expect(imagePointToScreenFraction(topLeft, 270)).toEqual({ x: 0, y: 1 });
  });

  it('puts a lower-left image point near the top after a 90° turn', () => {
    // The sea's top-left corner sits low in the image but near the top on screen.
    const screen = imagePointToScreenFraction({ x: 0.07, y: 0.75 }, 90);
    expect(screen.x).toBeCloseTo(0.25);
    expect(screen.y).toBeCloseTo(0.07);
  });
});
