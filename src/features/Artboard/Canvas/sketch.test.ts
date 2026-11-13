import { describe, expect, it } from 'vitest';

import { arrowSize, sketchArrow, sketchLine, strokeWidthOf } from './sketch';

const points: [number, number][] = [
  [640, 200],
  [680, 200],
  [680, 500],
  [720, 500],
];

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('sketchLine', () => {
  it('draws the same wobble for the same edge every time', () => {
    expect(sketchLine(points, 'edge_1')).toBe(sketchLine(points, 'edge_1'));
    expect(sketchLine(points, 'edge_1')).not.toBe(sketchLine(points, 'edge_2'));
  });

  it('leaves and arrives exactly at the two boards', () => {
    const drawn = numbers(sketchLine(points, 'edge_1'));
    expect(drawn.slice(0, 2)).toEqual([640, 200]);
    expect(drawn.slice(-2)).toEqual([720, 500]);
  });

  it('never strays more than a few units from the straight route', () => {
    const drawn = numbers(sketchLine(points, 'edge_1'));
    const xs = drawn.filter((_, i) => i % 2 === 0);
    const ys = drawn.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThan(630);
    expect(Math.max(...xs)).toBeLessThan(730);
    expect(Math.min(...ys)).toBeGreaterThan(190);
    expect(Math.max(...ys)).toBeLessThan(510);
  });
});

describe('sketchArrow', () => {
  it('draws two strokes that meet at the tip and open backwards', () => {
    const drawn = sketchArrow(points, 24, 'edge_1');
    const strokes = drawn.split('M').filter(Boolean).map(numbers);
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes) {
      expect(stroke.slice(-2)).toEqual([720, 500]);
      expect(stroke[0]).toBeLessThan(720);
    }
  });
});

describe('zoom', () => {
  it('lets the arrow and the line grow and shrink with the canvas', () => {
    expect(arrowSize(1)).toBe(arrowSize(0.5));
    expect(strokeWidthOf(1, false)).toBe(strokeWidthOf(0.7, false));
  });

  it('keeps them visible when the canvas is tiny', () => {
    expect(arrowSize(0.1) * 0.1).toBeGreaterThanOrEqual(5);
    expect(strokeWidthOf(0.1, false) * 0.1).toBeGreaterThanOrEqual(1);
    expect(arrowSize(0.1)).toBeLessThan(80);
  });

  it('draws a highlighted edge heavier', () => {
    expect(strokeWidthOf(1, true)).toBeGreaterThan(strokeWidthOf(1, false));
  });
});
