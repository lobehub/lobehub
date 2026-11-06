import type { BoardModel } from '../model';
import type { ArtboardState } from './initialState';

const isQuoteLocked = (board: BoardModel) => (s: ArtboardState) =>
  board.finalized && !!s.selected && board.frameById[s.selected]?.groupId === board.journeyGroupId;

const selectedCheckFrame = (board: BoardModel) => (s: ArtboardState) =>
  s.selected && board.frameById[s.selected]?.groupId === board.journeyGroupId ? s.selected : null;

export const artboardSelectors = {
  isQuoteLocked,
  selectedCheckFrame,
};
