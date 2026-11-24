import {
  ARTBOARD_SITE_FILES_DIR,
  type ArtboardItem,
  type ArtboardPublishSnapshot,
} from '@lobechat/types';

export interface ViewerBoard {
  artboard: ArtboardItem;
  fileBaseUrl: string;
}

export const snapshotToBoard = (snapshot: ArtboardPublishSnapshot): ViewerBoard => {
  const publishedAt = new Date(snapshot.publishedAt);

  return {
    artboard: {
      acceptanceId: null,
      content: {
        boards: snapshot.boards.map((board) => ({ ...board, expected: null, flowNodeId: null })),
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
    fileBaseUrl: ARTBOARD_SITE_FILES_DIR,
  };
};
