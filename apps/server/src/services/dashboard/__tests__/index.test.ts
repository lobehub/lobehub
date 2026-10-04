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
      x: DASHBOARD_GRID.maxColumns,
      y: 5,
    });
  });
});
