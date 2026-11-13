export type Point = [number, number];

const WOBBLE = 3;
const BOW = 4;

const seeded = (seed: string) => {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  };
};

const fmt = (value: number) => String(Math.round(value * 10) / 10);
const at = ([x, y]: Point) => `${fmt(x)} ${fmt(y)}`;

const stroke = (points: Point[], random: () => number) => {
  const last = points.length - 1;
  const nodes = points.map(([x, y], i): Point =>
    i === 0 || i === last ? [x, y] : [x + random() * WOBBLE, y + random() * WOBBLE],
  );
  let d = `M${at(nodes[0])}`;
  for (let i = 1; i < nodes.length; i++) {
    const [x1, y1] = nodes[i - 1];
    const [x2, y2] = nodes[i];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) continue;
    const bow = Math.min(BOW, length / 12);
    const nx = (-(y2 - y1) / length) * bow;
    const ny = ((x2 - x1) / length) * bow;
    const a = random();
    const b = random();
    d += ` C${at([x1 + (x2 - x1) * 0.35 + nx * a, y1 + (y2 - y1) * 0.35 + ny * a])} ${at([
      x1 + (x2 - x1) * 0.7 + nx * b,
      y1 + (y2 - y1) * 0.7 + ny * b,
    ])} ${at(nodes[i])}`;
  }
  return d;
};

export const sketchLine = (points: Point[], seed: string) => {
  const random = seeded(seed);
  return `${stroke(points, random)} ${stroke(points, random)}`;
};

const headingOf = (points: Point[]) => {
  for (let i = points.length - 1; i > 0; i--) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    if (dx || dy) return Math.atan2(dy, dx);
  }
  return 0;
};

export const sketchArrow = (points: Point[], size: number, seed: string) => {
  const random = seeded(`${seed}:arrow`);
  const tip = points.at(-1)!;
  const heading = headingOf(points);
  return [-1, 1]
    .map((side) => {
      const angle = heading + Math.PI + side * (0.45 + random() * 0.08);
      const reach = size * (1 + random() * 0.12);
      const tail: Point = [tip[0] + Math.cos(angle) * reach, tip[1] + Math.sin(angle) * reach];
      const bend = size * 0.08 * random();
      const mid: Point = [
        (tail[0] + tip[0]) / 2 - Math.sin(angle) * bend,
        (tail[1] + tip[1]) / 2 + Math.cos(angle) * bend,
      ];
      return `M${at(tail)} Q${at(mid)} ${at(tip)}`;
    })
    .join(' ');
};

export const arrowSize = (k: number) => Math.max(22, 6 / k);

export const strokeWidthOf = (k: number, strong: boolean) =>
  Math.max(1.5, 1 / k) * (strong ? 1.6 : 1);
