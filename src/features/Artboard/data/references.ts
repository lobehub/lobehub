import type { ArtboardReference } from '@/features/ChatInput/InputEditor/ReferArtboard';

import type { BoardModel } from '../model';

export const boardReference = (
  board: BoardModel,
  itemId: string,
  kind: ArtboardReference['kind'],
  text: string,
): ArtboardReference | undefined => {
  const frame = board.frameById[itemId];
  const note = frame ? undefined : board.noteById[itemId];
  if (!frame && !note) return;
  return {
    artboardId: board.artboard.id,
    itemId,
    itemKind: frame ? 'frame' : 'note',
    itemTitle: frame ? frame.title : note!.text,
    kind,
    text: text.trim(),
  };
};
