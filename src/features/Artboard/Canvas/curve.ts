export type Point = [number, number];

const CORNER = 24;
const CHEVRON_SPREAD = 0.5;

const fmt = (value: number) => String(Math.round(value * 10) / 10);
const at = ([x, y]: Point) => `${fmt(x)} ${fmt(y)}`;

const unit = (a: Point, b: Point): Point => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return length ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [0, 0];
};

const between = (value: number, a: number, b: number) =>
  value >= Math.min(a, b) && value <= Math.max(a, b);

// A direct route turns once between the two boards; a detour leaves the span to get around others.
const isDirect = (points: Point[]) => {
  if (points.length !== 4) return false;
  const [p0, p1, , p3] = points;
  return p0[1] === p1[1] ? between(p1[0], p0[0], p3[0]) : between(p1[1], p0[1], p3[1]);
};

const roundedPolyline = (points: Point[]) => {
  let d = `M${at(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const radius = Math.min(
      CORNER,
      Math.hypot(corner[0] - prev[0], corner[1] - prev[1]) / 2,
      Math.hypot(next[0] - corner[0], next[1] - corner[1]) / 2,
    );
    const into = unit(prev, corner);
    const out = unit(corner, next);
    d += ` L${at([corner[0] - into[0] * radius, corner[1] - into[1] * radius])}`;
    d += ` Q${at(corner)} ${at([corner[0] + out[0] * radius, corner[1] + out[1] * radius])}`;
  }
  return `${d} L${at(points.at(-1)!)}`;
};

// The arrowhead sits on a straight lead-in; on a steep curve the last stretch is nearly
// perpendicular to the board, so a chevron drawn on the curve itself reads as crooked.
export const edgeCurve = (points: Point[], lead = 0) => {
  if (!isDirect(points)) return roundedPolyline(points);
  const [p0, p1, , p3] = points;
  const horizontal = p0[1] === p1[1];
  const axis = horizontal ? 0 : 1;
  const direction = Math.sign(p3[axis] - p0[axis]);
  const span = Math.abs(p3[axis] - p0[axis]);
  const straight = Math.min(lead, span / 2);
  const end: Point = [...p3];
  end[axis] -= direction * straight;
  const reach = (span - straight) / 2;
  const c1: Point = [...p0];
  c1[axis] += direction * reach;
  const c2: Point = [...end];
  c2[axis] -= direction * reach;
  const curve = `M${at(p0)} C${at(c1)} ${at(c2)} ${at(end)}`;
  return straight ? `${curve} L${at(p3)}` : curve;
};

const headingOf = (points: Point[]) => {
  for (let i = points.length - 1; i > 0; i--) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    if (dx || dy) return Math.atan2(dy, dx);
  }
  return 0;
};

export const edgeArrow = (points: Point[], size: number) => {
  const tip = points.at(-1)!;
  const heading = headingOf(points);
  const [a, b] = [-1, 1].map((side): Point => {
    const angle = heading + Math.PI + side * CHEVRON_SPREAD;
    return [tip[0] + Math.cos(angle) * size, tip[1] + Math.sin(angle) * size];
  });
  return `M${at(a)} L${at(tip)} L${at(b)}`;
};

const CHEVRON_PER_STROKE = 3.75;
export const ARROW_STROKE_RATIO = 0.7;

export const arrowSize = (strokeWidth: number) => strokeWidth * CHEVRON_PER_STROKE;

export const strokeWidthOf = (k: number, strong: boolean) =>
  Math.max(4, 1.5 / k) * (strong ? 1.5 : 1);
