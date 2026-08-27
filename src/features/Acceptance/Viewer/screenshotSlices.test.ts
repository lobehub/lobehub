import { describe, expect, it } from 'vitest';

import {
  annotationInSlice,
  isPortraitScreenshot,
  SCREENSHOT_SLICE_ASPECT,
  screenshotSliceObjectPosition,
  screenshotSlices,
} from './screenshotSlices';

describe('screenshotSlices', () => {
  it('returns nothing without intrinsic size', () => {
    expect(screenshotSlices()).toBeUndefined();
    expect(screenshotSlices(390, null)).toBeUndefined();
    expect(screenshotSlices(0, 2412)).toBeUndefined();
  });

  it('keeps a single phone screen as one image', () => {
    expect(screenshotSlices(390, 844)).toBeUndefined();
    expect(screenshotSlices(390, 1687)).toBeUndefined();
    expect(screenshotSlices(1206, 2622)).toBeUndefined();
  });

  it('splits a long mobile capture into phone-screen tiles', () => {
    expect(screenshotSlices(390, 2412)).toEqual([
      { height: 844, index: 0, top: 0 },
      { height: 844, index: 1, top: 844 },
      { height: 724, index: 2, top: 1688 },
    ]);
  });

  it('uses the same screen aspect on a 3x capture', () => {
    const width = 1170;
    const slice = Math.round(width * SCREENSHOT_SLICE_ASPECT);
    const slices = screenshotSlices(width, slice * 2 + 100);
    expect(slices).toEqual([
      { height: slice, index: 0, top: 0 },
      { height: slice, index: 1, top: slice },
      { height: 100, index: 2, top: slice * 2 },
    ]);
  });
});

describe('isPortraitScreenshot', () => {
  it('treats an iPhone capture as portrait', () => {
    expect(isPortraitScreenshot(1206, 2622)).toBe(true);
  });

  it('leaves landscape desktop captures alone', () => {
    expect(isPortraitScreenshot(1280, 720)).toBe(false);
  });

  it('leaves a wide header crop alone', () => {
    expect(isPortraitScreenshot(1206, 570)).toBe(false);
    expect(isPortraitScreenshot(1206, 385)).toBe(false);
  });
});

describe('screenshotSliceObjectPosition', () => {
  it('pins the first slice to the top and the last slice to the bottom', () => {
    const slices = screenshotSlices(390, 2412)!;
    expect(screenshotSliceObjectPosition(slices[0]!, 2412)).toBe('0 0%');
    expect(screenshotSliceObjectPosition(slices[2]!, 2412)).toBe('0 100%');
  });
});

describe('annotationInSlice', () => {
  const slices = screenshotSlices(390, 2412)!;

  it('maps a rect onto the slice that contains it', () => {
    const rect = annotationInSlice({ height: 0.04, width: 0.2, x: 0.7, y: 0.72 }, slices[2]!, 2412);
    expect(rect?.width).toBe(0.2);
    expect(rect?.x).toBe(0.7);
    expect(rect?.height).toBeCloseTo((0.04 * 2412) / 724);
    expect(rect?.y).toBeCloseTo((0.72 * 2412 - 1688) / 724);
  });

  it('ignores a rect that lives on another slice', () => {
    expect(
      annotationInSlice({ height: 0.04, width: 0.2, x: 0.7, y: 0.72 }, slices[0]!, 2412),
    ).toBeUndefined();
  });

  it('clips a rect that crosses a slice edge', () => {
    const y = (844 - 20) / 2412;
    const height = 40 / 2412;
    const first = annotationInSlice({ height, width: 0.3, x: 0.1, y }, slices[0]!, 2412);
    const second = annotationInSlice({ height, width: 0.3, x: 0.1, y }, slices[1]!, 2412);
    expect(first?.y).toBeCloseTo(824 / 844);
    expect(first?.height).toBeCloseTo(20 / 844);
    expect(second?.y).toBeCloseTo(0);
    expect(second?.height).toBeCloseTo(20 / 844);
  });
});
