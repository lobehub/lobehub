/** Stored in message history — never rename. */
export const MiniGameIdentifier = 'lobe-mini-game';

export const MiniGameApiName = {
  getGameState: 'getGameState',
  moveTo: 'moveTo',
  sitOn: 'sitOn',
  watch: 'watch',
} as const;

export type MiniGameApiNameType = (typeof MiniGameApiName)[keyof typeof MiniGameApiName];

/** Actions an object can host. `moveTo` means "walk up to it". */
export type GameActionName = 'moveTo' | 'sitOn' | 'watch';

export type GameObjectKind = 'bench' | 'garden' | 'house' | 'lamp' | 'pond' | 'tree' | 'well';

/** A cell of the scene grid. The origin is the top-left corner. */
export interface GridPoint {
  x: number;
  y: number;
}

export interface GameObject {
  actions: GameActionName[];
  /** Short note for the model, e.g. how many fish swim in the pond. */
  description?: string;
  /** Cells the object covers; walking through them is impossible. */
  footprint: GridPoint[];
  /** Stable id, the only way the model may refer to the object. */
  id: string;
  /** Cells next to the object where the character stands to use it. */
  interactPoints: GridPoint[];
  kind: GameObjectKind;
  /** Canonical English name; UIs localize by `kind`. */
  name: string;
  /** Where a seated character is drawn; `sitOn` objects only. */
  seat?: GridPoint;
}

export interface GameScene {
  id: string;
  name: string;
  objects: GameObject[];
  size: { height: number; width: number };
}

export type CharacterPose = 'idle' | 'sitting' | 'walking' | 'watching';

export type Facing = 'east' | 'north' | 'south' | 'west';

export interface CharacterActivity {
  action: GameActionName;
  targetId?: string;
}

export interface CharacterState {
  /** What the character is busy with; absent while idle. */
  activity?: CharacterActivity;
  facing: Facing;
  pose: CharacterPose;
  position: GridPoint;
}

export interface MoveToParams {
  targetId?: string;
  x?: number;
  y?: number;
}

export interface SitOnParams {
  targetId: string;
}

export interface WatchParams {
  targetId: string;
}

/** A validated request to do something in the scene. */
export type GameActionRequest =
  | { action: 'moveTo'; targetId: string }
  | { action: 'moveTo'; point: GridPoint }
  | { action: 'sitOn'; targetId: string }
  | { action: 'watch'; targetId: string };

export type MiniGameErrorType =
  | 'action_not_supported'
  | 'game_not_open'
  | 'interrupted'
  | 'invalid_params'
  | 'target_not_found'
  | 'unreachable';

export interface MiniGameError {
  message: string;
  type: MiniGameErrorType;
}

/** Result-domain state the tool returns for the UI. */
export interface MiniGameActionState {
  arrived: boolean;
  pose: CharacterPose;
  position: GridPoint;
  steps: number;
  targetId?: string;
}
