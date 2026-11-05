import { describe, expect, it } from 'vitest';

import { INITIAL_CHARACTER_STATE, PIXEL_YARD_SCENE } from '../../scene';
import type { CharacterState, GridPoint } from '../../types';
import { findPath, getBlockedCells } from '../pathfinding';
import { findNearbyObject, planAction } from '../planAction';

const scene = PIXEL_YARD_SCENE;
const start = INITIAL_CHARACTER_STATE;

const isAdjacent = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

const expectContinuousPath = (from: GridPoint, path: GridPoint[]) => {
  let previous = from;
  for (const cell of path) {
    expect(isAdjacent(previous, cell)).toBe(true);
    previous = cell;
  }
};

describe('findPath', () => {
  it('walks around objects and never steps on a blocked cell', () => {
    const path = findPath(scene, { x: 8, y: 6 }, { x: 12, y: 6 })!;
    const blocked = getBlockedCells(scene);

    expect(path.at(-1)).toEqual({ x: 12, y: 6 });
    expectContinuousPath({ x: 8, y: 6 }, path);
    expect(path.some((p) => blocked.has(`${p.x},${p.y}`))).toBe(false);
    // The pond is 3 cells wide, so the detour is longer than the straight line.
    expect(path.length).toBeGreaterThan(4);
  });

  it('returns nothing for a blocked or out-of-bounds destination', () => {
    expect(findPath(scene, start.position, { x: 10, y: 6 })).toBeUndefined();
    expect(findPath(scene, start.position, { x: 99, y: 0 })).toBeUndefined();
  });

  it('can start from a blocked cell (standing up from the bench)', () => {
    expect(findPath(scene, { x: 2, y: 6 }, { x: 2, y: 8 })).toEqual([
      { x: 2, y: 7 },
      { x: 2, y: 8 },
    ]);
  });

  it('never accepts a blocked destination, not even the blocked cell it starts on', () => {
    // A seated character's cell is the bench seat: "walking" there is not standing there.
    expect(findPath(scene, { x: 2, y: 6 }, { x: 2, y: 6 })).toBeUndefined();
    expect(findPath(scene, { x: 6, y: 4 }, { x: 6, y: 4 })).toEqual([]);
  });
});

describe('planAction', () => {
  it('sits on the bench: walks to it, ends on the seat, sitting', () => {
    const result = planAction(scene, start, { action: 'sitOn', targetId: 'bench_1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { final, path, targetId } = result.plan;
    expect(targetId).toBe('bench_1');
    expect(path.at(-1)).toEqual({ x: 2, y: 6 });
    expectContinuousPath(start.position, path);
    expect(final).toEqual({
      activity: { action: 'sitOn', targetId: 'bench_1' },
      facing: 'south',
      pose: 'sitting',
      position: { x: 2, y: 6 },
    });
  });

  it('watches the pond from the nearest pond-side cell, facing the water', () => {
    const result = planAction(scene, start, { action: 'watch', targetId: 'pond_1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { final, path } = result.plan;
    const pondSide = scene.objects.find((o) => o.id === 'pond_1')!.interactPoints;
    expect(pondSide).toContainEqual(final.position);
    expect(path.at(-1)).toEqual(final.position);
    expect(final.pose).toBe('watching');
    expect(final.activity).toEqual({ action: 'watch', targetId: 'pond_1' });
    expect(final.facing).toBe('east');
  });

  it('stands up from the bench before walking to the pond', () => {
    const seated: CharacterState = {
      activity: { action: 'sitOn', targetId: 'bench_1' },
      facing: 'south',
      pose: 'sitting',
      position: { x: 2, y: 6 },
    };
    const result = planAction(scene, seated, { action: 'watch', targetId: 'pond_1' });
    expect(result.ok).toBe(true);
    if (result.ok) expectContinuousPath(seated.position, result.plan.path);
  });

  it('does nothing when already doing the same thing', () => {
    const seated: CharacterState = {
      activity: { action: 'sitOn', targetId: 'bench_1' },
      facing: 'south',
      pose: 'sitting',
      position: { x: 2, y: 6 },
    };
    const result = planAction(scene, seated, { action: 'sitOn', targetId: 'bench_1' });
    expect(result).toMatchObject({ ok: true, plan: { alreadyDone: true, path: [] } });
  });

  it('refuses an unknown object and lists the real ones', () => {
    const result = planAction(scene, start, { action: 'moveTo', targetId: 'swimming_pool' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('target_not_found');
    expect(result.error.message).toContain('bench_1');
    expect(result.error.message).toContain('pond_1');
  });

  it('refuses an action the object does not support', () => {
    const result = planAction(scene, start, { action: 'sitOn', targetId: 'pond_1' });
    expect(result).toMatchObject({ error: { type: 'action_not_supported' }, ok: false });
    if (!result.ok) expect(result.error.message).toContain('moveTo, watch');
  });

  it('refuses cells outside the yard or under an object', () => {
    expect(planAction(scene, start, { action: 'moveTo', point: { x: 20, y: 1 } })).toMatchObject({
      error: { type: 'invalid_params' },
    });
    expect(planAction(scene, start, { action: 'moveTo', point: { x: 10, y: 6 } })).toMatchObject({
      error: { type: 'unreachable' },
    });
  });

  it('refuses to stand up into the bench seat itself', () => {
    const seated: CharacterState = {
      activity: { action: 'sitOn', targetId: 'bench_1' },
      facing: 'south',
      pose: 'sitting',
      position: { x: 2, y: 6 },
    };
    expect(planAction(scene, seated, { action: 'moveTo', point: { x: 2, y: 6 } })).toMatchObject({
      error: { type: 'unreachable' },
      ok: false,
    });
  });

  it('walks to a free cell and stands idle there', () => {
    const result = planAction(scene, start, { action: 'moveTo', point: { x: 6, y: 8 } });
    expect(result).toMatchObject({
      ok: true,
      plan: { final: { facing: 'south', pose: 'idle', position: { x: 6, y: 8 } } },
    });
  });
});

describe('findNearbyObject', () => {
  it('names the object the character uses or stands next to', () => {
    expect(findNearbyObject(scene, start)).toBeUndefined();
    expect(findNearbyObject(scene, { ...start, position: { x: 2, y: 3 } })?.id).toBe('house_1');
    expect(
      findNearbyObject(scene, {
        ...start,
        activity: { action: 'watch', targetId: 'pond_1' },
        position: { x: 8, y: 6 },
      })?.id,
    ).toBe('pond_1');
  });
});
