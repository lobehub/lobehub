import { describe, expect, it } from 'vitest';

import {
  chartAreaPath,
  chartFraction,
  chartLinePath,
  chartSegments,
  chartTicks,
  getChartDomain,
  projectChartPoint,
} from './chartGeometry';

const bounds = { bottom: 200, left: 60, right: 660, top: 20 };
const xDomain = { max: 1000, min: 0 };
const yDomain = { max: 150, min: 0 };

describe('native chart geometry', () => {
  it('places the current x and series values on the same scale as the curves', () => {
    expect(projectChartPoint({ x: 500, y: 60 }, xDomain, yDomain, bounds)).toEqual({
      x: 360,
      y: 128,
    });
    expect(projectChartPoint({ x: 500, y: 50 }, xDomain, yDomain, bounds)).toEqual({
      x: 360,
      y: 140,
    });
    expect(projectChartPoint({ x: 500, y: 65 }, xDomain, yDomain, bounds)?.x).toBe(360);
  });

  it('updates markers exactly for nonsampled values and changed container widths', () => {
    const point = projectChartPoint({ x: 333, y: 39.96 }, xDomain, yDomain, bounds)!;
    expect(point.x).toBeCloseTo(259.8);
    expect(point.y).toBeCloseTo(152.048);
    const narrow = projectChartPoint({ x: 333, y: 39.96 }, xDomain, yDomain, {
      ...bounds,
      right: 300,
    })!;
    expect(narrow.x).toBeCloseTo(139.92);
  });

  it('never clamps an out-of-range marker onto a misleading edge', () => {
    expect(projectChartPoint({ x: 1001, y: 60 }, xDomain, yDomain, bounds)).toBeNull();
    expect(projectChartPoint({ x: 500, y: Number.NaN }, xDomain, yDomain, bounds)).toBeNull();
    expect(projectChartPoint({ x: 500, y: Infinity }, xDomain, yDomain, bounds)).toBeNull();
    expect(chartFraction(5, { max: 1, min: 1 })).toBeNull();
  });

  it('leaves a visible gap for unavailable values rather than inventing a line', () => {
    const segments = chartSegments(
      [
        { price: 0, x: 0 },
        { price: 30, x: 250 },
        { price: null, x: 500 },
        { price: 90, x: 750 },
        { price: Infinity, x: 800 },
        { price: 120, x: 1000 },
      ],
      'price',
      xDomain,
      yDomain,
      bounds,
    );
    expect(segments.map((segment) => segment.length)).toEqual([2, 1, 1]);
    expect(chartLinePath(segments[0])).toBe('M60,200 L210,164');
    expect(chartAreaPath(segments[0], 200)).toBe('M60,200 L210,164 L210,200 L60,200 Z');
    expect(chartAreaPath([], 200)).toBe('');
  });

  it('handles empty, all-zero, negative, and constant values without a zero-size domain', () => {
    expect(getChartDomain([null, undefined, '50', Infinity, Number.NaN])).toEqual({
      max: 1,
      min: 0,
    });
    expect(getChartDomain([0, 0])).toEqual({ max: 1, min: 0 });
    expect(getChartDomain([60, 60])).toEqual({ max: 65, min: 0 });
    expect(getChartDomain([-10, 20])).toEqual({ max: 25, min: -15 });
    expect(chartTicks({ max: 1, min: 1 })).toEqual([]);
    expect(chartTicks(yDomain)).toEqual([0, 37.5, 75, 112.5, 150]);
  });

  it('keeps extreme finite values finite rather than overflowing the drawing', () => {
    const domain = getChartDomain([-Number.MAX_VALUE, Number.MAX_VALUE]);
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
    expect(chartFraction(0, domain)).toBe(0.5);
    expect(chartTicks(domain).every(Number.isFinite)).toBe(true);
    expect(getChartDomain([Number.MIN_VALUE])).toEqual({ max: Number.MIN_VALUE, min: 0 });
  });
});
