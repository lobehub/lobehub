type Matrix2D = [number, number, number, number, number, number];

type MatrixInit =
  ArrayLike<number> | { a: number; b: number; c: number; d: number; e: number; f: number };

const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

const readInit = (init?: MatrixInit | null): Matrix2D => {
  if (init === undefined || init === null) return [...IDENTITY];

  if (typeof init === 'string') {
    throw new TypeError('DOMMatrix string initializers are not supported');
  }

  if (Array.isArray(init) || ArrayBuffer.isView(init)) {
    const values = Array.from(init as ArrayLike<number>);
    if (values.length === 6) return values as Matrix2D;
    if (values.length === 16) {
      return [values[0], values[1], values[4], values[5], values[12], values[13]];
    }
    throw new TypeError(`Expected 6 or 16 matrix values, received ${values.length}`);
  }

  const { a, b, c, d, e, f } = init as Exclude<MatrixInit, ArrayLike<number>>;
  return [a, b, c, d, e, f];
};

const compose = (m: Matrix2D, n: Matrix2D): Matrix2D => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * Minimal 2D-only DOMMatrix. pdfjs-dist instantiates `new DOMMatrix()` at module
 * scope (`SCALE_MATRIX`, pdf.mjs), so importing it in Node throws without a global.
 * Upstream polyfills this from `@napi-rs/canvas` — a 25MB Skia binary whose canvas
 * surface we never touch, because we only call `page.getTextContent()`.
 */
export class DOMMatrixPolyfill {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(init?: MatrixInit | null) {
    [this.a, this.b, this.c, this.d, this.e, this.f] = readInit(init);
  }

  get is2D(): boolean {
    return true;
  }

  get isIdentity(): boolean {
    return (
      this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
    );
  }

  get m11(): number {
    return this.a;
  }

  get m12(): number {
    return this.b;
  }

  get m21(): number {
    return this.c;
  }

  get m22(): number {
    return this.d;
  }

  get m41(): number {
    return this.e;
  }

  get m42(): number {
    return this.f;
  }

  private tuple(): Matrix2D {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  private assign(values: Matrix2D): this {
    [this.a, this.b, this.c, this.d, this.e, this.f] = values;
    return this;
  }

  multiplySelf(other?: MatrixInit): this {
    return this.assign(compose(this.tuple(), readInit(other)));
  }

  preMultiplySelf(other?: MatrixInit): this {
    return this.assign(compose(readInit(other), this.tuple()));
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.assign(compose(this.tuple(), [1, 0, 0, 1, tx, ty]));
  }

  scaleSelf(sx = 1, sy = sx, _sz = 1, originX = 0, originY = 0): this {
    let m = this.tuple();
    if (originX || originY) m = compose(m, [1, 0, 0, 1, originX, originY]);
    m = compose(m, [sx, 0, 0, sy, 0, 0]);
    if (originX || originY) m = compose(m, [1, 0, 0, 1, -originX, -originY]);
    return this.assign(m);
  }

  rotateSelf(degrees = 0): this {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return this.assign(compose(this.tuple(), [cos, sin, -sin, cos, 0, 0]));
  }

  invertSelf(): this {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant || !Number.isFinite(determinant)) {
      return this.assign([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
    }

    const { a, b, c, d, e, f } = this;
    return this.assign([
      d / determinant,
      -b / determinant,
      -c / determinant,
      a / determinant,
      (c * f - d * e) / determinant,
      (b * e - a * f) / determinant,
    ]);
  }

  multiply(other?: MatrixInit): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill(this).multiplySelf(other);
  }

  translate(tx?: number, ty?: number): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill(this).translateSelf(tx, ty);
  }

  scale(sx?: number, sy?: number, sz?: number, originX?: number, originY?: number) {
    return new DOMMatrixPolyfill(this).scaleSelf(sx, sy, sz, originX, originY);
  }

  rotate(degrees?: number): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill(this).rotateSelf(degrees);
  }

  inverse(): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill(this).invertSelf();
  }

  transformPoint(point: { x?: number; y?: number } = {}) {
    const { x = 0, y = 0 } = point;
    return { w: 1, x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0 };
  }

  toFloat64Array(): Float64Array {
    return Float64Array.from(this.tuple());
  }

  toString(): string {
    return `matrix(${this.tuple().join(', ')})`;
  }
}

/**
 * Must run before `pdfjs-dist` is evaluated — its module scope reads the global.
 */
export const installDomMatrixPolyfill = () => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = DOMMatrixPolyfill as unknown as typeof globalThis.DOMMatrix;
  }
};
