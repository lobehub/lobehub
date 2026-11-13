import type { EdgePath } from './model';

export const EDGE_LANE_GAP = 14;
export const EDGE_LABEL_SLOT = 32;
const LANE_MARGIN = 4;
const LABEL_NEAR = 160;

type Spreadable = EdgePath & { id: string };

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

const stackLabels = <T extends Spreadable>(edges: T[], labelled: (edge: T) => boolean): T[] => {
  const sorted = edges.filter(labelled).toSorted((p, q) => p.ly - q.ly || p.lx - q.lx);
  const piles: T[][] = [];
  for (const edge of sorted) {
    const pile = piles.find((members) => {
      const last = members.at(-1)!;
      return Math.abs(last.lx - edge.lx) < LABEL_NEAR && edge.ly - last.ly < EDGE_LABEL_SLOT;
    });
    if (pile) pile.push(edge);
    else piles.push([edge]);
  }

  const moved = new Map<string, T>();
  for (const pile of piles) {
    if (pile.length < 2) continue;
    const centre = pile.reduce((sum, e) => sum + e.ly, 0) / pile.length;
    pile.forEach((edge, index) => {
      moved.set(edge.id, { ...edge, ly: centre + centred(index, pile.length, EDGE_LABEL_SLOT) });
    });
  }

  return edges.map((edge) => moved.get(edge.id) ?? edge);
};

export const spreadEdges = <T extends Spreadable>(
  edges: T[],
  labelled: (edge: T) => boolean,
): T[] => stackLabels(splitLanes(edges), labelled);
