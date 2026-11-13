import type { ArtboardReference } from '@/features/ChatInput/InputEditor/ReferArtboard';

import type { BoardModel } from '../model';

export const boardReference = (
  board: BoardModel,
  boardId: string,
  text: string,
): ArtboardReference | undefined => {
  const target = board.boardById[boardId];
  if (!target) return;
  return {
    artboardId: board.artboard.id,
    itemId: boardId,
    itemTitle: target.title,
    text: text.trim(),
  };
};
