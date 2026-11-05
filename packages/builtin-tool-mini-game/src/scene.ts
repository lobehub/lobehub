import type { CharacterState, GameObject, GameScene, GridPoint } from './types';

const cells = (x0: number, y0: number, x1: number, y1: number): GridPoint[] => {
  const out: GridPoint[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};

const objects: GameObject[] = [
  {
    actions: ['moveTo'],
    footprint: cells(1, 1, 3, 2),
    id: 'house_1',
    interactPoints: [{ x: 2, y: 3 }],
    kind: 'house',
    name: 'Cabin',
  },
  {
    actions: ['moveTo', 'watch'],
    description: 'cabbages are growing',
    footprint: cells(6, 1, 7, 2),
    id: 'garden_1',
    interactPoints: [
      { x: 6, y: 3 },
      { x: 7, y: 3 },
    ],
    kind: 'garden',
    name: 'Vegetable patch',
  },
  {
    actions: ['moveTo'],
    footprint: [{ x: 11, y: 1 }],
    id: 'well_1',
    interactPoints: [
      { x: 11, y: 2 },
      { x: 10, y: 1 },
      { x: 12, y: 1 },
    ],
    kind: 'well',
    name: 'Well',
  },
  {
    actions: ['moveTo', 'sitOn'],
    description: 'a wooden bench for one',
    footprint: cells(2, 6, 3, 6),
    id: 'bench_1',
    interactPoints: [
      { x: 2, y: 7 },
      { x: 3, y: 7 },
    ],
    kind: 'bench',
    name: 'Bench',
    seat: { x: 2, y: 6 },
  },
  {
    actions: ['moveTo', 'watch'],
    description: 'glows softly',
    footprint: [{ x: 5, y: 6 }],
    id: 'lamp_1',
    interactPoints: [
      { x: 5, y: 7 },
      { x: 6, y: 6 },
    ],
    kind: 'lamp',
    name: 'Street lamp',
  },
  {
    actions: ['moveTo', 'watch'],
    description: 'three koi fish swim among the lily pads',
    footprint: cells(9, 5, 11, 7),
    id: 'pond_1',
    interactPoints: [
      { x: 8, y: 6 },
      { x: 10, y: 4 },
      { x: 12, y: 6 },
      { x: 10, y: 8 },
    ],
    kind: 'pond',
    name: 'Pond',
  },
  {
    actions: ['moveTo'],
    footprint: [{ x: 0, y: 4 }],
    id: 'tree_1',
    interactPoints: [
      { x: 1, y: 4 },
      { x: 0, y: 5 },
    ],
    kind: 'tree',
    name: 'Pine tree',
  },
  {
    actions: ['moveTo'],
    footprint: [{ x: 13, y: 8 }],
    id: 'tree_2',
    interactPoints: [
      { x: 12, y: 8 },
      { x: 13, y: 7 },
    ],
    kind: 'tree',
    name: 'Maple tree',
  },
];

export const PIXEL_YARD_SCENE: GameScene = {
  id: 'pixel-yard',
  name: 'Pixel Yard',
  objects,
  size: { height: 10, width: 14 },
};

export const INITIAL_CHARACTER_STATE: CharacterState = {
  facing: 'south',
  pose: 'idle',
  position: { x: 6, y: 4 },
};

export const findObject = (scene: GameScene, id: string): GameObject | undefined =>
  scene.objects.find((object) => object.id === id);
