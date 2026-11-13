import type { BoardModel } from '../model';
import type { ArtboardState } from './initialState';

const inJourney = (board: BoardModel, id: string | null) =>
  !!id && !!board.journeyGroupId && board.boardById[id]?.groupId === board.journeyGroupId;

const selectedCheckBoard = (board: BoardModel) => (s: ArtboardState) =>
  inJourney(board, s.selected) ? s.selected : null;

export const artboardSelectors = {
  selectedCheckBoard,
};
