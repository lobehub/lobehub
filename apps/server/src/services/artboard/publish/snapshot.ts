import { createHash } from 'node:crypto';

import type { ArtboardItem, ArtboardPublishSnapshot } from '@lobechat/types';

import { withoutDraftPicks } from '../view';

export interface ArtboardPublishFileRef {
  hash: string;
  path: string;
}

export const buildArtboardPublishSnapshot = (
  artboard: ArtboardItem,
  { publishedAt }: { publishedAt: string },
): ArtboardPublishSnapshot => {
  const { content } = withoutDraftPicks(artboard);
  return {
    boards: content.boards.map((board) => ({
      groupId: board.groupId,
      id: board.id,
      pageId: board.pageId,
      rect: board.rect,
      roundId: board.roundId,
      source: board.source,
      title: board.title,
      type: board.type,
    })),
    description: artboard.description,
    edges: content.edges.map((edge) => ({
      condition: edge.condition,
      from: edge.from,
      id: edge.id,
      isDefault: edge.isDefault,
      label: edge.label,
      to: edge.to,
    })),
    groups: content.groups,
    pages: content.pages,
    publishedAt,
    rounds: content.rounds.map((round) => ({
      chosenBoardId: round.chosenBoardId,
      id: round.id,
      pageId: round.pageId,
      recommendedBoardId: round.recommendedBoardId,
      status: round.status,
      title: round.title,
    })),
    title: artboard.title,
    version: 1,
  };
};

// Files are part of what was shared: a page's stylesheet or image can change without any board moving.
export const hashArtboardSnapshot = (
  { publishedAt: _, ...rest }: ArtboardPublishSnapshot,
  files: ArtboardPublishFileRef[],
) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        ...rest,
        files: files
          .map(({ hash, path }) => [path, hash])
          .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      }),
    )
    .digest('hex');
