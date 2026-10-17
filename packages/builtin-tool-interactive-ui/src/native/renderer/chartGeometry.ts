export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartDomain {
  max: number;
  min: number;
}

export interface ChartBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Include zero, and leave headroom without turning invalid values into data. */
export const getChartDomain = (values: readonly unknown[]): ChartDomain => {
  const numbers = values.filter(isFiniteNumber);
  if (numbers.length === 0) return { max: 1, min: 0 };

  const min = Math.min(0, ...numbers);
  const max = Math.max(0, ...numbers);
  if (min === max) return { max: 1, min: 0 };

  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const step = 10 ** Math.floor(Math.log10(magnitude)) / 2;
  // Subnormal and extreme finite numbers still need a finite, nonzero domain.
  if (!Number.isFinite(step) || step === 0) return { max, min };
  const paddedMin = min < 0 ? Math.floor((min - magnitude * 0.05) / step) * step : 0;
  const paddedMax = max > 0 ? Math.ceil((max + magnitude * 0.05) / step) * step : 0;
  return {
    max: Number.isFinite(paddedMax) ? paddedMax : max,
    min: Number.isFinite(paddedMin) ? paddedMin : min,
  };
};

/** Normalizing first avoids overflow for domains spanning large signed values. */
export const chartFraction = (value: number, domain: ChartDomain): number | null => {
  if (![value, domain.min, domain.max].every(isFiniteNumber) || domain.max <= domain.min) {
    return null;
  }
  const scale = Math.max(Math.abs(domain.min), Math.abs(domain.max), Math.abs(value));
  const fraction = (value / scale - domain.min / scale) / (domain.max / scale - domain.min / scale);
  return Number.isFinite(fraction) ? fraction : null;
};

export const chartTicks = (domain: ChartDomain, count = 5): number[] => {
  if (![domain.min, domain.max].every(isFiniteNumber) || domain.min >= domain.max) return [];
  const size = Math.min(10, Math.max(2, Math.trunc(count)));
  return Array.from({ length: size }, (_, index) => {
    const fraction = index / (size - 1);
    return domain.min * (1 - fraction) + domain.max * fraction;
  });
};

export const projectChartPoint = (
  point: ChartPoint,
  xDomain: ChartDomain,
  yDomain: ChartDomain,
  bounds: ChartBounds,
): ChartPoint | null => {
  const x = chartFraction(point.x, xDomain);
  const y = chartFraction(point.y, yDomain);
  if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return {
    x: bounds.left + x * (bounds.right - bounds.left),
    y: bounds.bottom - y * (bounds.bottom - bounds.top),
  };
};

/** Null/invalid samples break a line instead of falsely connecting across gaps. */
export const chartSegments = (
  rows: ReadonlyArray<Record<string, number | null>>,
  seriesId: string,
  xDomain: ChartDomain,
  yDomain: ChartDomain,
  bounds: ChartBounds,
): ChartPoint[][] => {
  const segments: ChartPoint[][] = [];
  let segment: ChartPoint[] = [];
  for (const row of rows) {
    const point =
      isFiniteNumber(row.x) && isFiniteNumber(row[seriesId])
        ? projectChartPoint({ x: row.x, y: row[seriesId] }, xDomain, yDomain, bounds)
        : null;
    if (point) {
      segment.push(point);
    } else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  }
  if (segment.length) segments.push(segment);
  return segments;
};

export const chartLinePath = (points: readonly ChartPoint[]): string =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');

export const chartAreaPath = (points: readonly ChartPoint[], baseline: number): string => {
  if (points.length === 0 || !isFiniteNumber(baseline)) return '';
  return `${chartLinePath(points)} L${points.at(-1)!.x},${baseline} L${points[0].x},${baseline} Z`;
};
