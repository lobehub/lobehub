import type { EdgePath } from './model';

export const EDGE_LANE_GAP = 14;
/** Minimum vertical gap kept between two label boxes before they count as clear. */
export const EDGE_LABEL_SLOT = 8;
/** Vertical slots a label may try before it is treated as crowded and hidden. */
const MAX_LABEL_SLOTS = 4;
const LANE_MARGIN = 4;

type Spreadable = EdgePath & { id: string };

export interface EdgeLabelBox {
  h: number;
  w: number;
}

export interface SpreadEdgesOptions<T extends Spreadable> {
  /** Size of the label that renders at `edge.lx` / `edge.ly`. */
  labelBox: (edge: T) => EdgeLabelBox;
  labelled: (edge: T) => boolean;
  /** Boards a label must not sit on. */
  obstacles?: readonly Box[];
}

export interface SpreadEdgesResult<T extends Spreadable> {
  edges: T[];
  /**
   * Labels whose box could not be cleared from every other label. Rendering
   * keeps them to hover/selection so the overview stays readable.
   */
  hiddenLabels: Set<string>;
}

const corridorOf = (edge: EdgePath) => {
  const [, a, b] = edge.points;
  return a[0] === b[0] && a[1] !== b[1]
    ? { max: Math.max(a[1], b[1]), min: Math.min(a[1], b[1]), x: a[0] }
    : undefined;
};

const centred = (index: number, count: number, step: number) => (index - (count - 1) / 2) * step;

const toLane = <T extends Spreadable>(edge: T, x: number): T => {
  const [start, a, b, end] = edge.points;
  return {
    ...edge,
    d: `M${start[0]} ${start[1]} H${x} V${b[1]} H${end[0]}`,
    lx: x,
    points: [start, [x, a[1]], [x, b[1]], end],
  };
};

const splitLanes = <T extends Spreadable>(edges: T[]): T[] => {
  const byX = new Map<number, T[]>();
  for (const edge of edges) {
    const corridor = corridorOf(edge);
    if (corridor) byX.set(corridor.x, [...(byX.get(corridor.x) ?? []), edge]);
  }

  const moved = new Map<string, T>();
  for (const sharing of byX.values()) {
    const sorted = sharing.toSorted((p, q) => corridorOf(p)!.min - corridorOf(q)!.min);
    const bundles: T[][] = [];
    let reach = -Infinity;
    for (const edge of sorted) {
      const { max, min } = corridorOf(edge)!;
      if (min < reach) bundles.at(-1)!.push(edge);
      else bundles.push([edge]);
      reach = Math.max(reach, max);
    }

    for (const bundle of bundles) {
      if (bundle.length < 2) continue;
      const room = Math.min(...bundle.map((e) => e.room));
      const step = Math.max(
        0,
        Math.min(EDGE_LANE_GAP, (room - LANE_MARGIN * 2) / (bundle.length - 1)),
      );
      bundle
        .toSorted((p, q) => p.points[0][1] - q.points[0][1] || p.id.localeCompare(q.id))
        .forEach((edge, index) => {
          moved.set(edge.id, toLane(edge, edge.points[1][0] + centred(index, bundle.length, step)));
        });
    }
  }

  return edges.map((edge) => moved.get(edge.id) ?? edge);
};

interface Box {
  h: number;
  w: number;
  x: number;
  y: number;
}

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Width-aware label placement. Labels are anchored at their edge midpoint, so a
 * long label on a near-parallel edge used to run straight through its
 * neighbour: the old centre-distance heuristic never saw the glyphs. Here every
 * label is treated as a box the size it actually renders, and the first clear
 * vertical slot wins (0, +1, −1, +2, −2 …). A label with no clear slot within
 * {@link MAX_LABEL_SLOTS} is reported as crowded instead of being drawn on top
 * of another one.
 */
const placeLabels = <T extends Spreadable>(
  edges: T[],
  { labelBox, labelled, obstacles = [] }: SpreadEdgesOptions<T>,
): { edges: T[]; hiddenLabels: Set<string> } => {
  const hiddenLabels = new Set<string>();
  const placed: Box[] = [];
  const moved = new Map<string, T>();

  const sorted = edges
    .filter(labelled)
    .toSorted((p, q) => p.ly - q.ly || p.lx - q.lx || p.id.localeCompare(q.id));

  for (const edge of sorted) {
    const size = labelBox(edge);
    if (size.w <= 0 || size.h <= 0) continue;

    const step = size.h + EDGE_LABEL_SLOT;
    const slots = [0];
    for (let slot = 1; slot <= MAX_LABEL_SLOTS; slot += 1) slots.push(slot, -slot);

    const dy = slots
      .map((slot) => slot * step)
      .find((offset) => {
        const candidate = {
          h: size.h,
          w: size.w,
          x: edge.lx - size.w / 2,
          y: edge.ly + offset - size.h / 2,
        };
        const clear =
          placed.every((other) => !overlaps(candidate, other, EDGE_LABEL_SLOT)) &&
          obstacles.every((board) => !overlaps(candidate, board, 0));
        if (clear) placed.push(candidate);
        return clear;
      });

    if (dy === undefined) {
      hiddenLabels.add(edge.id);
      continue;
    }
    if (dy !== 0) moved.set(edge.id, { ...edge, ly: edge.ly + dy });
  }

  return { edges: edges.map((edge) => moved.get(edge.id) ?? edge), hiddenLabels };
};

export const spreadEdges = <T extends Spreadable>(
  edges: T[],
  options: SpreadEdgesOptions<T>,
): SpreadEdgesResult<T> => placeLabels(splitLanes(edges), options);
