import { describe, expect, it } from 'vitest';

import { DASHBOARD_GRID, normalizeItemLayout } from '../index';

describe('normalizeItemLayout', () => {
  it('rounds to whole cells and keeps spans and offsets on the grid', () => {
    expect(normalizeItemLayout({ h: 2.4, w: 0, x: -3, y: 1.6 })).toEqual({
      h: 2,
      w: 1,
      x: 0,
      y: 2,
    });
    expect(normalizeItemLayout({ h: 999, w: 999, x: 999, y: 5 })).toEqual({
      h: DASHBOARD_GRID.maxSpan,
      w: DASHBOARD_GRID.maxSpan,
      x: DASHBOARD_GRID.maxColumns - DASHBOARD_GRID.maxSpan,
      y: 5,
    });
  });

  it('keeps the whole item inside the last column', () => {
    // a wide item near the right edge is pulled left so it ends on the grid
    expect(normalizeItemLayout({ h: 1, w: 20, x: 80, y: 0 })).toMatchObject({ w: 20, x: 76 });
    // a one-cell item cannot start past the final column
    expect(normalizeItemLayout({ h: 1, w: 1, x: 96, y: 0 })).toMatchObject({ w: 1, x: 95 });
    // the clamp uses the normalized width, not the raw one
    expect(normalizeItemLayout({ h: 1, w: 0, x: 96, y: 0 })).toMatchObject({ w: 1, x: 95 });
    expect(normalizeItemLayout({ h: 1, w: 999, x: 60, y: 0 })).toMatchObject({ w: 48, x: 48 });
    for (const layout of [
      { h: 1, w: 20, x: 80, y: 0 },
      { h: 1, w: 1, x: 96, y: 0 },
      { h: 1, w: 48, x: 1000, y: 0 },
    ]) {
      const { w, x } = normalizeItemLayout(layout);
      expect(x + w).toBeLessThanOrEqual(DASHBOARD_GRID.maxColumns);
    }
  });
});
