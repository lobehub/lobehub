import type { ArtboardBoardType } from '@lobechat/types';

import { failArtboard } from './errors';
import type { ResolvedArtboardOp, ResolvedBoardSource } from './sources';

export const sourceColumns = (source?: ResolvedBoardSource) => ({
  sourceFileId: source?.kind === 'image' ? source.fileId : null,
  sourcePath: source?.kind === 'canvas' ? source.path : null,
  sourceWorkVersionId: source?.kind === 'canvas' ? source.workVersionId : null,
});

export const boardTypeOf = (
  requested: ArtboardBoardType | undefined,
  source: ResolvedBoardSource | undefined,
): ArtboardBoardType => {
  if (requested === 'video') return failArtboard('invalid', 'Video boards are not supported yet');
  if (requested === 'decision') {
    if (source) failArtboard('invalid', 'A decision board has no source');
    return 'decision';
  }
  if (!source)
    return failArtboard('invalid', 'A board needs a source unless its type is "decision"');
  const derived = source.kind === 'image' ? 'image' : 'html';
  if (requested && requested !== derived)
    failArtboard('invalid', `A ${source.kind} source makes an "${derived}" board`);
  return derived;
};

export const resolveOpRefs = (
  op: ResolvedArtboardOp,
  refs: Map<string, string>,
): ResolvedArtboardOp => {
  const id = (value: string) => refs.get(value) ?? value;
  const optionalId = <T extends string | null | undefined>(value: T) =>
    (value ? id(value) : value) as T;

  switch (op.type) {
    case 'addPage': {
      return op;
    }
    case 'addRound': {
      return { ...op, round: { ...op.round, pageId: optionalId(op.round.pageId) } };
    }
    case 'addGroup': {
      return { ...op, group: { ...op.group, pageId: optionalId(op.group.pageId) } };
    }
    case 'addBoard': {
      return {
        ...op,
        board: {
          ...op.board,
          groupId: optionalId(op.board.groupId),
          pageId: optionalId(op.board.pageId),
          roundId: optionalId(op.board.roundId),
        },
      };
    }
    case 'updateBoard': {
      return {
        ...op,
        id: id(op.id),
        patch: {
          ...op.patch,
          ...('groupId' in op.patch ? { groupId: optionalId(op.patch.groupId) } : {}),
          ...('roundId' in op.patch ? { roundId: optionalId(op.patch.roundId) } : {}),
        },
      };
    }
    case 'addEdge': {
      return { ...op, edge: { ...op.edge, from: id(op.edge.from), to: id(op.edge.to) } };
    }
    case 'setCheck': {
      return { ...op, boardId: id(op.boardId) };
    }
    default: {
      return { ...op, id: id(op.id) };
    }
  }
};
