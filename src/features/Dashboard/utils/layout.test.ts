import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_GRID_GAP,
  DASHBOARD_ROW_HEIGHT,
  defaultWidgetSize,
  flowLayouts,
  resolveLayouts,
  sortByPosition,
} from './layout';

describe('defaultWidgetSize', () => {
  it('gives a stat card room for its value, description and trend line', () => {
    const { h } = defaultWidgetSize('stat');
    const cellHeight = h * DASHBOARD_ROW_HEIGHT + (h - 1) * DASHBOARD_GRID_GAP;
    // padding 24 + header 22 + label/value/description 83 + trend 28 + footer 18 + gaps 28
    expect(cellHeight).toBeGreaterThanOrEqual(203);
  });
});

describe('resolveLayouts', () => {
  it('keeps persisted layouts that fit and do not collide', () => {
    const result = resolveLayouts([
      { id: 'a', layout: { h: 2, w: 3, x: 0, y: 0 } },
      { id: 'b', layout: { h: 4, w: 6, x: 6, y: 0 } },
    ]);
    expect(result).toEqual({
      a: { h: 2, w: 3, x: 0, y: 0 },
      b: { h: 4, w: 6, x: 6, y: 0 },
    });
  });

  it('places items without a layout into the first free slot by output type', () => {
    const result = resolveLayouts([
      { id: 'a', layout: { h: 2, w: 3, x: 0, y: 0 } },
      { id: 'stat', outputType: 'stat' },
      { id: 'table', outputType: 'table' },
    ]);
    expect(result.stat).toEqual({ h: 3, w: 3, x: 3, y: 0 });
    // A full-width table cannot share rows 0-2 with anything.
    expect(result.table).toEqual({ h: 4, w: DASHBOARD_GRID_COLUMNS, x: 0, y: 3 });
  });

  it('re-places a colliding or out-of-grid layout instead of overlapping', () => {
    const result = resolveLayouts([
      { id: 'a', layout: { h: 2, w: 6, x: 0, y: 0 } },
      { id: 'overlap', layout: { h: 2, w: 6, x: 3, y: 0 } },
      { id: 'overflow', layout: { h: 2, w: 6, x: 10, y: 0 } },
    ]);
    expect(result.overlap).toEqual({ h: 2, w: 6, x: 6, y: 0 });
    expect(result.overflow).toEqual({ h: 2, w: 6, x: 0, y: 2 });
  });
});

describe('flowLayouts', () => {
  it('wraps items into rows in the given order', () => {
    expect(
      flowLayouts([
        { h: 2, id: 'a', w: 6 },
        { h: 4, id: 'b', w: 6 },
        { h: 2, id: 'c', w: 4 },
      ]),
    ).toEqual({
      a: { h: 2, w: 6, x: 0, y: 0 },
      b: { h: 4, w: 6, x: 6, y: 0 },
      c: { h: 2, w: 4, x: 0, y: 4 },
    });
  });

  it('clamps sizes into the grid', () => {
    expect(flowLayouts([{ h: 99, id: 'a', w: 99 }]).a).toEqual({ h: 12, w: 12, x: 0, y: 0 });
  });
});

describe('sortByPosition', () => {
  it('orders top to bottom, then left to right', () => {
    const layouts = {
      a: { h: 2, w: 3, x: 6, y: 0 },
      b: { h: 2, w: 3, x: 0, y: 2 },
      c: { h: 2, w: 3, x: 0, y: 0 },
    };
    expect(
      sortByPosition([{ id: 'a' }, { id: 'b' }, { id: 'c' }], layouts).map((i) => i.id),
    ).toEqual(['c', 'a', 'b']);
  });
});
