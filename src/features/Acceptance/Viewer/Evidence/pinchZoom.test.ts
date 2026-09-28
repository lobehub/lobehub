import { describe, expect, it } from 'vitest';

import { anchoredScroll, pinchedZoom, touchDistance, touchMidpoint } from './pinchZoom';

describe('pinchedZoom', () => {
  it('scales the zoom at pinch start by how far the fingers spread', () => {
    expect(pinchedZoom(1, 100, 150, 0.5, 4)).toBeCloseTo(1.5);
    expect(pinchedZoom(2, 100, 50, 0.5, 4)).toBeCloseTo(1);
  });

  it('starts from the zoom the buttons had already set', () => {
    expect(pinchedZoom(1.5, 80, 160, 0.5, 4)).toBeCloseTo(3);
  });

  it('never leaves the range the zoom buttons can reach', () => {
    expect(pinchedZoom(1, 100, 1000, 0.5, 4)).toBe(4);
    expect(pinchedZoom(1, 100, 10, 0.5, 4)).toBe(0.5);
  });

  it('holds still when the start distance is degenerate', () => {
    expect(pinchedZoom(1.5, 0, 120, 0.5, 4)).toBe(1.5);
  });
});

describe('anchoredScroll', () => {
  it('keeps the point under the fingers in place while the content grows', () => {
    // Anchor 100px into the viewport, content already scrolled 50px: the
    // content point under the anchor sits at 150px. At 2x it sits at 300px, so
    // the scroll must move to 300 - 100 = 200 for it to stay under the finger.
    expect(anchoredScroll(50, 100, 2)).toBe(200);
  });

  it('shrinking anchors the same way and never scrolls past the origin', () => {
    expect(anchoredScroll(200, 100, 0.5)).toBe(50);
    expect(anchoredScroll(0, 100, 0.5)).toBe(0);
  });
});

describe('touch geometry', () => {
  it('measures the distance and midpoint between two fingers', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(touchMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});
