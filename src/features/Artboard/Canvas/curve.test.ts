import { describe, expect, it } from 'vitest';

import { arrowSize, edgeArrow, edgeCurve, strokeWidthOf } from './curve';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

const direct: [number, number][] = [
  [640, 200],
  [680, 200],
  [680, 500],
  [720, 500],
];

const detour: [number, number][] = [
  [320, 400],
  [320, 640],
  [1000, 640],
  [1000, 400],
];

describe('edgeCurve', () => {
  it('bends a direct route into one smooth curve that leaves and enters level', () => {
    const d = edgeCurve(direct);
    expect(d).toMatch(/^M640 200 C/);
    expect(numbers(d)).toEqual([640, 200, 680, 200, 680, 500, 720, 500]);
  });

  it('arrives on a straight lead-in so the arrowhead lines up with the line', () => {
    const steep: [number, number][] = [
      [1680, 340],
      [1720, 340],
      [1720, 1350],
      [1760, 1350],
    ];
    const d = edgeCurve(steep, 10);
    expect(d).toMatch(/ L1760 1350$/);
    expect(numbers(d).slice(-4)).toEqual([1750, 1350, 1760, 1350]);
  });

  it('draws the same path every time', () => {
    expect(edgeCurve(direct)).toBe(edgeCurve(direct));
  });

  it('keeps a detour on its route around other boards, only rounding the corners', () => {
    const d = edgeCurve(detour);
    expect(d).not.toContain('C');
    expect(numbers(d).slice(0, 2)).toEqual([320, 400]);
    expect(numbers(d).slice(-2)).toEqual([1000, 400]);
    expect(Math.max(...numbers(d).filter((_, i) => i % 2 === 1))).toBe(640);
  });
});

describe('edgeArrow', () => {
  it('opens a chevron backwards from the tip along the last heading', () => {
    const [ax, ay, tx, ty, bx, by] = numbers(edgeArrow(direct, 10));
    expect([tx, ty]).toEqual([720, 500]);
    expect(ax).toBeLessThan(720);
    expect(bx).toBeLessThan(720);
    expect(Math.sign(ay - 500)).toBe(-Math.sign(by - 500));
  });
});

describe('sizes', () => {
  it('draws a 4px line that never gets thinner than 1.5px on screen', () => {
    expect(strokeWidthOf(0.25, false)).toBe(6);
    expect(strokeWidthOf(1, false)).toBe(4);
    expect(strokeWidthOf(2, false)).toBe(4);
    expect(strokeWidthOf(1, true)).toBe(6);
  });

  it('sizes the chevron from the stroke it ends', () => {
    expect(arrowSize(4)).toBeCloseTo(15);
    expect(arrowSize(6)).toBeCloseTo(22.5);
  });
});
