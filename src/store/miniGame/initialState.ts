import {
  type CharacterState,
  type GameScene,
  type GridPoint,
  INITIAL_CHARACTER_STATE,
  PIXEL_YARD_SCENE,
} from '@lobechat/builtin-tool-mini-game';

export interface MiniGameState {
  character: CharacterState;
  /** The game panel is mounted; tools and snapshots only work while it is. */
  isOpen: boolean;
  /** Cells the character still has to walk through for the action in flight. */
  path: GridPoint[];
  /** Object the action in flight heads to. */
  pendingTargetId?: string;
  scene: GameScene;
}

export const initialState: MiniGameState = {
  character: INITIAL_CHARACTER_STATE,
  isOpen: false,
  path: [],
  scene: PIXEL_YARD_SCENE,
};
