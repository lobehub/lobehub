import type { Facing, GameScene, GridPoint } from '../types';

const key = (p: GridPoint) => `${p.x},${p.y}`;

export const isSamePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;

export const isInBounds = (scene: GameScene, p: GridPoint) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  p.x >= 0 &&
  p.y >= 0 &&
  p.x < scene.size.width &&
  p.y < scene.size.height;

/** Cells covered by any object. */
export const getBlockedCells = (scene: GameScene): Set<string> =>
  new Set(scene.objects.flatMap((object) => object.footprint.map(key)));

export const isWalkable = (scene: GameScene, p: GridPoint, blocked = getBlockedCells(scene)) =>
  isInBounds(scene, p) && !blocked.has(key(p));

const NEIGHBORS: GridPoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * Shortest 4-directional path on the scene grid (breadth-first; every step
 * costs the same). Returns the cells to walk through, excluding `from` and
 * including `to`; an empty array when already standing on `to`; `undefined`
 * when `to` is blocked or cannot be reached. The start cell may be blocked (a seated character sits
 * on the bench), every other cell must be walkable.
 */
export const findPath = (
  scene: GameScene,
  from: GridPoint,
  to: GridPoint,
): GridPoint[] | undefined => {
  // The destination is checked first: a seated character may leave its
  // blocked seat, but "walking" onto that same seat is not standing there.
  const blocked = getBlockedCells(scene);
  if (!isWalkable(scene, to, blocked)) return;
  if (isSamePoint(from, to)) return [];

  const previous = new Map<string, GridPoint | null>([[key(from), null]]);
  const queue: GridPoint[] = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (isSamePoint(current, to)) break;

    for (const delta of NEIGHBORS) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      if (previous.has(key(next)) || !isWalkable(scene, next, blocked)) continue;
      previous.set(key(next), current);
      queue.push(next);
    }
  }

  if (!previous.has(key(to))) return;

  const path: GridPoint[] = [];
  for (let p: GridPoint | null = to; p && !isSamePoint(p, from); p = previous.get(key(p)) ?? null)
    path.unshift(p);
  return path;
};

/** The direction to look from `from` towards `to`; horizontal wins ties. */
export const facingTowards = (from: GridPoint, to: GridPoint, fallback: Facing): Facing => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
};
