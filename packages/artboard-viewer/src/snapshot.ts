import type {
  ArtboardBoardSource,
  ArtboardItem,
  ArtboardPublishSnapshot,
  ArtboardPublishSource,
} from '@lobechat/types';

export interface ViewerBoard {
  artboard: ArtboardItem;
  canvasSrc: Record<string, string>;
  imageUrls: Record<string, string>;
}

const viewSource = (
  boardId: string,
  source: ArtboardPublishSource | null,
): ArtboardBoardSource | null => {
  switch (source?.kind) {
    case 'canvas': {
      return { canvasId: boardId, kind: 'canvas', version: 1 };
    }
    case 'image': {
      return { fileId: boardId, kind: 'image' };
    }
    default: {
      return null;
    }
  }
};

export const snapshotToBoard = (snapshot: ArtboardPublishSnapshot): ViewerBoard => {
  const canvasSrc: Record<string, string> = {};
  const imageUrls: Record<string, string> = {};
  const publishedAt = new Date(snapshot.publishedAt);

  const boards = snapshot.boards.map(({ source, ...board }) => {
    if (source?.kind === 'canvas') canvasSrc[board.id] = source.src;
    if (source?.kind === 'image') imageUrls[board.id] = source.src;
    return {
      ...board,
      expected: null,
      flowNodeId: null,
      source: viewSource(board.id, source),
    };
  });

  return {
    artboard: {
      acceptanceId: null,
      content: {
        boards,
        edges: snapshot.edges.map((edge) => ({ ...edge, flowEdgeId: null })),
        groups: snapshot.groups,
        pages: snapshot.pages,
        questions: [],
        rounds: snapshot.rounds.map((round) => ({ ...round, batchId: null })),
      },
      createdAt: publishedAt,
      description: snapshot.description,
      id: 'published',
      phase: 'discuss',
      projectId: null,
      revision: 1,
      taskId: null,
      title: snapshot.title,
      topicId: null,
      updatedAt: publishedAt,
    },
    canvasSrc,
    imageUrls,
  };
};
