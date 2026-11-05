import { describe, expect, it } from 'vitest';

import { INITIAL_CHARACTER_STATE, PIXEL_YARD_SCENE } from '../../scene';
import {
  buildGameContextSelection,
  buildGameStateXml,
  describeCharacter,
  describeSurroundings,
  relativeDirection,
} from '../snapshot';

describe('buildGameStateXml', () => {
  it('lists the scene, every object with id/name/cells/actions, and the character', () => {
    const xml = buildGameStateXml(PIXEL_YARD_SCENE, INITIAL_CHARACTER_STATE);

    expect(xml).toContain(
      '<game_state scene="pixel-yard" name="Pixel Yard" width="14" height="10">',
    );
    expect(xml).toContain(
      '<self x="6" y="4" pose="idle" facing="south" activity="none" near="none"/>',
    );
    expect(xml).toContain(
      '<object id="bench_1" kind="bench" name="Bench" x="2" y="6" w="2" h="1" dir="down-left" steps="5" actions="moveTo,sitOn" note="a wooden bench for one"/>',
    );
    expect(xml).toContain(
      '<object id="pond_1" kind="pond" name="Pond" x="9" y="5" w="3" h="3" dir="right" steps="4" actions="moveTo,watch" note="three koi fish swim among the lily pads"/>',
    );
    for (const object of PIXEL_YARD_SCENE.objects) expect(xml).toContain(`id="${object.id}"`);
  });

  it('uses localized names and escapes them', () => {
    const xml = buildGameStateXml(PIXEL_YARD_SCENE, INITIAL_CHARACTER_STATE, {
      objectName: (object) => (object.kind === 'bench' ? '长椅 "A&B"' : object.name),
      sceneName: '像素小院',
    });
    expect(xml).toContain('name="像素小院"');
    expect(xml).toContain('name="长椅 &quot;A&amp;B&quot;"');
  });

  it('reports what the character is doing', () => {
    const xml = buildGameStateXml(PIXEL_YARD_SCENE, {
      activity: { action: 'sitOn', targetId: 'bench_1' },
      facing: 'south',
      pose: 'sitting',
      position: { x: 2, y: 6 },
    });
    expect(xml).toContain('pose="sitting"');
    expect(xml).toContain('activity="sitOn bench_1" near="bench_1"');
  });
});

describe('relativeDirection', () => {
  const at = (x: number, y: number) => ({ ...INITIAL_CHARACTER_STATE, position: { x, y } });
  const object = (id: string) => PIXEL_YARD_SCENE.objects.find((o) => o.id === id)!;

  it('states screen direction from the nearest cell (bench is lower-left of the start)', () => {
    expect(relativeDirection(object('bench_1'), at(6, 4))).toEqual({ dir: 'down-left', steps: 5 });
    expect(relativeDirection(object('house_1'), at(6, 4))).toEqual({ dir: 'up-left', steps: 5 });
    expect(relativeDirection(object('well_1'), at(6, 4))).toEqual({ dir: 'up-right', steps: 8 });
    expect(relativeDirection(object('tree_1'), at(6, 4))).toEqual({ dir: 'left', steps: 6 });
  });

  it('follows the character and reports here when standing on the object', () => {
    expect(relativeDirection(object('bench_1'), at(12, 6))).toMatchObject({ dir: 'left' });
    expect(relativeDirection(object('bench_1'), at(2, 6))).toEqual({ dir: 'here', steps: 0 });
  });
});

describe('describeSurroundings', () => {
  it('gives directions from the new spot after sitting on the bench', () => {
    const line = describeSurroundings(PIXEL_YARD_SCENE, {
      activity: { action: 'sitOn', targetId: 'bench_1' },
      facing: 'south',
      pose: 'sitting',
      position: { x: 2, y: 6 },
    });
    expect(line.startsWith('Around you now: ')).toBe(true);
    expect(line).toContain('bench_1 here');
    expect(line).toContain('lamp_1 right 3 step(s)');
    expect(line).toContain('pond_1 right 7 step(s)');
  });
});

describe('describeCharacter', () => {
  it('summarizes the state in one line for tool results', () => {
    expect(
      describeCharacter(PIXEL_YARD_SCENE, {
        activity: { action: 'watch', targetId: 'pond_1' },
        facing: 'east',
        pose: 'watching',
        position: { x: 8, y: 6 },
      }),
    ).toBe('position=(8,6); pose=watching; facing=east; activity=watch pond_1; near=pond_1');
  });
});

describe('buildGameContextSelection', () => {
  it('wraps the snapshot as a game context selection', () => {
    const selection = buildGameContextSelection(PIXEL_YARD_SCENE, INITIAL_CHARACTER_STATE, {
      preview: '像素小院',
      sceneName: '像素小院',
    });
    expect(selection).toMatchObject({
      format: 'xml',
      id: 'game:pixel-yard',
      preview: '像素小院',
      sceneId: 'pixel-yard',
      source: 'game',
      title: '像素小院',
    });
    expect(selection.content.startsWith('<game_state')).toBe(true);
  });
});
