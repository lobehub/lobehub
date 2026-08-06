import { describe, expect, it } from 'vitest';

import { DOMMatrixPolyfill } from './domMatrix';

const tuple = (m: DOMMatrixPolyfill) =>
  [m.a, m.b, m.c, m.d, m.e, m.f].map((n) => Number(n.toFixed(10)));

// Expected values captured from `@napi-rs/canvas`'s DOMMatrix, so this suite
// pins behavioural parity with the native implementation it replaced.
describe('DOMMatrixPolyfill', () => {
  it('constructs identity with no arguments', () => {
    expect(tuple(new DOMMatrixPolyfill())).toEqual([1, 0, 0, 1, 0, 0]);
    expect(new DOMMatrixPolyfill().isIdentity).toBe(true);
    expect(new DOMMatrixPolyfill().is2D).toBe(true);
  });

  it('constructs from a 6-value array', () => {
    expect(tuple(new DOMMatrixPolyfill([2, 0.5, -1, 3, 10, -20]))).toEqual([
      2, 0.5, -1, 3, 10, -20,
    ]);
  });

  it('constructs from a typed array', () => {
    expect(tuple(new DOMMatrixPolyfill(Float64Array.from([1, 2, 3, 4, 5, 6])))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('constructs from a 16-value 3D array by taking the 2D components', () => {
    const values = [2, 3, 0, 0, 4, 5, 0, 0, 0, 0, 1, 0, 6, 7, 0, 1];
    expect(tuple(new DOMMatrixPolyfill(values))).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('rejects an unsupported value count', () => {
    expect(() => new DOMMatrixPolyfill([1, 2, 3])).toThrow(/Expected 6 or 16/);
  });

  it('exposes m11..m42 aliases', () => {
    const m = new DOMMatrixPolyfill([1, 2, 3, 4, 5, 6]);
    expect([m.m11, m.m12, m.m21, m.m22, m.m41, m.m42]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('matches pdf.worker.mjs image-mask scaling', () => {
    const m = new DOMMatrixPolyfill().scaleSelf(1 / 800, -1 / 600).translateSelf(0, -600);
    expect(tuple(m)).toEqual([0.00125, 0, 0, -0.0016666667, 0, 1]);
  });

  it('matches pdf.mjs text-path composition', () => {
    const m = new DOMMatrixPolyfill([1, 0, 0, 1, 3, 4])
      .preMultiplySelf(new DOMMatrixPolyfill([2, 0, 0, 2, 1, 1]).invertSelf())
      .translate(10, 20)
      .scale(12, -12);
    expect(tuple(m)).toEqual([6, 0, 0, -6, 6, 11.5]);
  });

  it('matches pdf.mjs pattern composition', () => {
    const m = new DOMMatrixPolyfill([3, 1, 1, 3, 5, 5])
      .invertSelf()
      .multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, 2, 2]));
    expect(tuple(m)).toEqual([0.375, -0.125, -0.125, 0.375, -0.75, -0.75]);
  });

  it('translates and scales without mutating the receiver', () => {
    const base = new DOMMatrixPolyfill([2, 0, 0, 3, 1, 1]);
    expect(tuple(base.translate(5, 7))).toEqual([2, 0, 0, 3, 11, 22]);
    expect(tuple(base.scale(0.5, 4))).toEqual([1, 0, 0, 12, 1, 1]);
    expect(tuple(base)).toEqual([2, 0, 0, 3, 1, 1]);
  });

  it('inverts', () => {
    expect(tuple(new DOMMatrixPolyfill([2, 0.5, -1, 3, 10, -20]).invertSelf())).toEqual([
      0.4615384615, -0.0769230769, 0.1538461538, 0.3076923077, -1.5384615385, 6.9230769231,
    ]);
  });

  it('yields NaN components for a singular matrix', () => {
    const m = new DOMMatrixPolyfill([1, 2, 2, 4, 0, 0]).invertSelf();
    expect(tuple(m).every(Number.isNaN)).toBe(true);
  });

  it('multiplies in both directions', () => {
    const other = new DOMMatrixPolyfill([1, 2, 3, 4, 5, 6]);
    expect(tuple(new DOMMatrixPolyfill([2, 0.5, -1, 3, 10, -20]).multiplySelf(other))).toEqual([
      0, 6.5, 2, 13.5, 14, 0.5,
    ]);
    expect(tuple(new DOMMatrixPolyfill([2, 0.5, -1, 3, 10, -20]).preMultiplySelf(other))).toEqual([
      3.5, 6, 8, 10, -45, -54,
    ]);
  });

  it('rotates', () => {
    expect(tuple(new DOMMatrixPolyfill().rotateSelf(37))).toEqual([
      0.79863551, 0.6018150232, -0.6018150232, 0.79863551, 0, 0,
    ]);
  });

  it('scales around an origin', () => {
    expect(tuple(new DOMMatrixPolyfill([1, 0, 0, 1, 2, 3]).scaleSelf(2, 3, 1, 10, 20))).toEqual([
      2, 0, 0, 3, -8, -37,
    ]);
  });

  it('transforms a point', () => {
    const point = new DOMMatrixPolyfill([2, 0, 0, 3, 5, 5]).transformPoint({ x: 3, y: 4 });
    expect([point.x, point.y]).toEqual([11, 17]);
  });
});
