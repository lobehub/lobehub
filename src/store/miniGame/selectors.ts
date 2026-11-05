import { findNearbyObject } from '@lobechat/builtin-tool-mini-game/engine';

import type { MiniGameState } from './initialState';

const nearbyObject = (s: MiniGameState) => findNearbyObject(s.scene, s.character);

const isBusy = (s: MiniGameState) => s.path.length > 0;

export const miniGameSelectors = {
  isBusy,
  nearbyObject,
};
