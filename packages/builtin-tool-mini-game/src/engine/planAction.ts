import { findObject } from '../scene';
import type {
  CharacterState,
  Facing,
  GameActionRequest,
  GameObject,
  GameScene,
  GridPoint,
  MiniGameError,
} from '../types';
import { facingTowards, findPath, isInBounds, isSamePoint } from './pathfinding';

export interface ActionPlan {
  /** The character already does exactly this; nothing moves. */
  alreadyDone: boolean;
  /** The state once the plan has been walked. */
  final: CharacterState;
  /** Cells to walk through, in order, excluding the current one. */
  path: GridPoint[];
  targetId?: string;
}

export type PlanResult = { error: MiniGameError; ok: false } | { ok: true; plan: ActionPlan };

const fail = (type: MiniGameError['type'], message: string): PlanResult => ({
  error: { message, type },
  ok: false,
});

const objectCenter = (object: GameObject): GridPoint => {
  const n = object.footprint.length;
  return {
    x: object.footprint.reduce((sum, p) => sum + p.x, 0) / n,
    y: object.footprint.reduce((sum, p) => sum + p.y, 0) / n,
  };
};

const listObjects = (scene: GameScene) =>
  scene.objects.map((object) => `${object.id} (${object.name})`).join(', ');

const isAdjacent = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/**
 * Shortest reachable interaction cell of `object`, with the path to it. With
 * `adjacentTo`, only cells one step from that cell count (the seat is entered
 * from beside it, never diagonally).
 */
const routeToObject = (
  scene: GameScene,
  from: GridPoint,
  object: GameObject,
  adjacentTo?: GridPoint,
) => {
  const points = adjacentTo
    ? object.interactPoints.filter((point) => isAdjacent(point, adjacentTo))
    : object.interactPoints;
  let best: { path: GridPoint[]; point: GridPoint } | undefined;
  for (const point of points) {
    const path = findPath(scene, from, point);
    if (path && (!best || path.length < best.path.length)) best = { path, point };
  }
  return best;
};

const lastFacing = (from: GridPoint, path: GridPoint[], fallback: Facing): Facing => {
  if (path.length === 0) return fallback;
  const previous = path.length > 1 ? path.at(-2)! : from;
  return facingTowards(previous, path.at(-1)!, fallback);
};

/**
 * The state machine of the yard: decides where the character walks and what
 * it ends up doing for one request, or why it cannot. Pure — the caller
 * animates `path` and then commits `final`.
 */
export const planAction = (
  scene: GameScene,
  character: CharacterState,
  request: GameActionRequest,
): PlanResult => {
  const from = character.position;

  if ('point' in request) {
    const { point } = request;
    if (!isInBounds(scene, point))
      return fail(
        'invalid_params',
        `(${point.x},${point.y}) is outside the yard; x is 0-${scene.size.width - 1}, y is 0-${scene.size.height - 1}.`,
      );
    const path = findPath(scene, from, point);
    if (!path) return fail('unreachable', `(${point.x},${point.y}) is blocked by an object.`);
    return {
      ok: true,
      plan: {
        alreadyDone: path.length === 0 && character.pose === 'idle',
        final: { facing: lastFacing(from, path, character.facing), pose: 'idle', position: point },
        path,
      },
    };
  }

  const object = findObject(scene, request.targetId);
  if (!object)
    return fail(
      'target_not_found',
      `There is no "${request.targetId}" in ${scene.name}. Objects here: ${listObjects(scene)}.`,
    );

  if (!object.actions.includes(request.action))
    return fail(
      'action_not_supported',
      `${object.name} (${object.id}) does not support ${request.action}; it supports: ${object.actions.join(', ')}.`,
    );

  const activity = character.activity;
  if (
    request.action !== 'moveTo' &&
    activity?.action === request.action &&
    activity.targetId === object.id
  ) {
    return {
      ok: true,
      plan: { alreadyDone: true, final: character, path: [], targetId: object.id },
    };
  }

  const seat = request.action === 'sitOn' ? (object.seat ?? object.footprint[0]) : undefined;
  const route = routeToObject(scene, from, object, seat);
  if (!route) return fail('unreachable', `No path leads to ${object.name} (${object.id}).`);

  const center = objectCenter(object);

  if (seat) {
    return {
      ok: true,
      plan: {
        alreadyDone: false,
        final: {
          activity: { action: 'sitOn', targetId: object.id },
          facing: 'south',
          pose: 'sitting',
          position: seat,
        },
        path: [...route.path, seat],
        targetId: object.id,
      },
    };
  }

  const facing = facingTowards(route.point, center, character.facing);

  if (request.action === 'watch') {
    return {
      ok: true,
      plan: {
        alreadyDone: false,
        final: {
          activity: { action: 'watch', targetId: object.id },
          facing,
          pose: 'watching',
          position: route.point,
        },
        path: route.path,
        targetId: object.id,
      },
    };
  }

  return {
    ok: true,
    plan: {
      alreadyDone: route.path.length === 0 && character.pose === 'idle',
      final: { facing, pose: 'idle', position: route.point },
      path: route.path,
      targetId: object.id,
    },
  };
};

/** The object the character stands next to (or sits on), if any. */
export const findNearbyObject = (
  scene: GameScene,
  character: CharacterState,
): GameObject | undefined => {
  if (character.activity?.targetId) return findObject(scene, character.activity.targetId);
  const { position } = character;
  return scene.objects.find((object) =>
    object.interactPoints.some((point) => isSamePoint(point, position)),
  );
};
