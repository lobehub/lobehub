import {
  type ArtboardBoardSourceInput,
  type ArtboardBoardType,
  type ArtboardOp,
  isArtboardHtmlPath,
  isArtboardImagePath,
  normalizeArtboardFilePath,
} from '@lobechat/types';

import type { ArtboardBoardRow } from '@/database/models/artboard';

import { failArtboard } from './errors';

export const sourcePathOf = (source: ArtboardBoardSourceInput) =>
  normalizeArtboardFilePath(source.path) ??
  failArtboard('invalid', `"${source.path}" is not a valid artboard file path.`);

export const sourceHashKey = (
  board: Pick<ArtboardBoardRow, 'sourcePath'>,
  hashes: ReadonlyMap<string, string>,
): string | undefined => (board.sourcePath ? hashes.get(board.sourcePath) : undefined);

const derivedBoardType = (sourcePath: string): ArtboardBoardType => {
  if (isArtboardImagePath(sourcePath)) return 'image';
  if (isArtboardHtmlPath(sourcePath)) return 'html';
  return failArtboard(
    'invalid',
    `"${sourcePath}" is neither an HTML page nor an image a board can show`,
  );
};

export const boardTypeOf = (
  requested: ArtboardBoardType | undefined,
  sourcePath: string | undefined,
): ArtboardBoardType => {
  if (requested === 'video') return failArtboard('invalid', 'Video boards are not supported yet');
  if (requested === 'decision') {
    if (sourcePath) failArtboard('invalid', 'A decision board has no source');
    return 'decision';
  }
  if (!sourcePath)
    return failArtboard('invalid', 'A board needs a source unless its type is "decision"');
  const derived = derivedBoardType(sourcePath);
  if (requested && requested !== derived)
    failArtboard('invalid', `"${sourcePath}" makes an "${derived}" board`);
  return derived;
};

export const resolveOpRefs = (op: ArtboardOp, refs: Map<string, string>): ArtboardOp => {
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
