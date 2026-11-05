import type { GameContextSelection } from '@lobechat/types';

import type { CharacterState, GameObject, GameScene } from '../types';
import { findNearbyObject } from './planAction';

const escapeAttr = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export interface SnapshotNames {
  /** Display name of an object in the user's language; defaults to `object.name`. */
  objectName?: (object: GameObject) => string;
  /** Display name of the scene in the user's language; defaults to `scene.name`. */
  sceneName?: string;
}

const bounds = (object: GameObject) => {
  const xs = object.footprint.map((p) => p.x);
  const ys = object.footprint.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { h: Math.max(...ys) - y + 1, w: Math.max(...xs) - x + 1, x, y };
};

const activityLabel = (character: CharacterState) =>
  character.activity
    ? `${character.activity.action}${character.activity.targetId ? ` ${character.activity.targetId}` : ''}`
    : 'none';

/** One line for tool results: where the character is and what it is doing. */
export const describeCharacter = (scene: GameScene, character: CharacterState): string => {
  const near = findNearbyObject(scene, character);
  return [
    `position=(${character.position.x},${character.position.y})`,
    `pose=${character.pose}`,
    `facing=${character.facing}`,
    `activity=${activityLabel(character)}`,
    `near=${near?.id ?? 'none'}`,
  ].join('; ');
};

/**
 * The game state the model reads every turn: the scene, every object it may
 * interact with (id, name, cells, supported actions) and the character itself.
 */
export const buildGameStateXml = (
  scene: GameScene,
  character: CharacterState,
  names: SnapshotNames = {},
): string => {
  const objectName = names.objectName ?? ((object: GameObject) => object.name);
  const near = findNearbyObject(scene, character);

  const objectLines = scene.objects.map((object) => {
    const { h, w, x, y } = bounds(object);
    const attrs = [
      `id="${object.id}"`,
      `kind="${object.kind}"`,
      `name="${escapeAttr(objectName(object))}"`,
      `x="${x}"`,
      `y="${y}"`,
      `w="${w}"`,
      `h="${h}"`,
      `actions="${object.actions.join(',')}"`,
    ];
    if (object.description) attrs.push(`note="${escapeAttr(object.description)}"`);
    return `    <object ${attrs.join(' ')}/>`;
  });

  const self = [
    `x="${character.position.x}"`,
    `y="${character.position.y}"`,
    `pose="${character.pose}"`,
    `facing="${character.facing}"`,
    `activity="${escapeAttr(activityLabel(character))}"`,
    `near="${near?.id ?? 'none'}"`,
  ].join(' ');

  return [
    `<game_state scene="${scene.id}" name="${escapeAttr(names.sceneName ?? scene.name)}" width="${scene.size.width}" height="${scene.size.height}">`,
    `  <self ${self}/>`,
    '  <objects>',
    ...objectLines,
    '  </objects>',
    '</game_state>',
  ].join('\n');
};

/** The game snapshot as a context selection attached to the user message. */
export const buildGameContextSelection = (
  scene: GameScene,
  character: CharacterState,
  names: SnapshotNames & { preview?: string } = {},
): GameContextSelection => ({
  content: buildGameStateXml(scene, character, names),
  format: 'xml',
  id: `game:${scene.id}`,
  preview: names.preview,
  sceneId: scene.id,
  source: 'game',
  title: names.sceneName ?? scene.name,
});
