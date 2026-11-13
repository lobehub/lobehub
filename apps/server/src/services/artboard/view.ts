import type {
  ArtboardBoardSource,
  ArtboardCommentThreadView,
  ArtboardCommentView,
  ArtboardContent,
  ArtboardItem,
} from '@lobechat/types';

import type { ArtboardCommentRow, ArtboardRow } from '@/database/models/artboard';
import type { ArtboardCommentThread } from '@/database/models/artboard/comment';
import type { ArtboardStructure } from '@/database/models/artboard/structure';

import { toPageRect } from './layout';
import type { ArtboardCanvasRef } from './sources';

export const describeArtboard = (content: ArtboardContent) =>
  `${content.groups.length} groups · ${content.boards.length} boards`;

export const toArtboardItem = (row: ArtboardRow, content: ArtboardContent): ArtboardItem => ({
  acceptanceId: row.acceptanceId,
  content,
  createdAt: row.createdAt,
  description: row.description,
  id: row.id,
  phase: row.phase,
  projectId: row.projectId,
  revision: row.revision,
  taskId: row.taskId,
  title: row.title,
  topicId: row.topicId,
  updatedAt: row.updatedAt,
});

export const toCommentView = (row: ArtboardCommentRow): ArtboardCommentView => ({
  authorAgentId: row.authorAgentId,
  authorUserId: row.authorUserId,
  content: row.content,
  createdAt: row.createdAt,
  id: row.id,
});

export const toCommentThreadView = ({
  replies,
  root,
}: ArtboardCommentThread): ArtboardCommentThreadView => ({
  ...toCommentView(root),
  anchor: root.anchor ?? null,
  boardId: root.boardId,
  groupId: root.groupId,
  pageId: root.pageId,
  replies: replies.map(toCommentView),
  resolvedAt: root.resolvedAt,
});

export const toArtboardContent = (
  structure: ArtboardStructure,
  openThreads: ArtboardCommentThread[],
  canvases: Record<string, ArtboardCanvasRef>,
): ArtboardContent => {
  const groupRects = new Map(structure.groups.map((group) => [group.id, group.rect]));

  const sourceOf = (board: ArtboardStructure['boards'][number]): ArtboardBoardSource | null => {
    if (board.sourceWorkVersionId) {
      const canvas = canvases[board.sourceWorkVersionId];
      return canvas
        ? {
            canvasId: canvas.canvasId,
            kind: 'canvas',
            ...(board.sourcePath ? { path: board.sourcePath } : {}),
            version: canvas.version,
          }
        : null;
    }
    return board.sourceFileId ? { fileId: board.sourceFileId, kind: 'image' } : null;
  };

  return {
    boards: structure.boards.map((board) => ({
      expected: board.expected,
      flowNodeId: board.acceptanceFlowNodeId,
      groupId: board.groupId,
      id: board.id,
      pageId: board.pageId,
      rect: toPageRect(board.rect, board.groupId ? groupRects.get(board.groupId) : undefined),
      roundId: board.roundId,
      source: sourceOf(board),
      title: board.title,
      type: board.type,
    })),
    edges: structure.edges.map((edge) => ({
      condition: edge.condition,
      flowEdgeId: edge.acceptanceFlowEdgeId,
      from: edge.sourceBoardId,
      id: edge.id,
      isDefault: edge.isDefault,
      label: edge.label,
      to: edge.targetBoardId,
    })),
    groups: structure.groups.map((group) => ({
      desc: group.description ?? '',
      id: group.id,
      kind: group.kind,
      pageId: group.pageId,
      rect: group.rect,
      title: group.title,
    })),
    pages: structure.pages.map((page) => ({
      id: page.id,
      name: page.name,
      sortOrder: page.sortOrder,
    })),
    questions: openThreads
      .filter((thread) => thread.root.authorAgentId)
      .map(({ root }) => ({
        boardId: root.boardId,
        content: root.content,
        groupId: root.groupId,
        id: root.id,
        pageId: root.pageId,
      })),
    rounds: structure.rounds.map((round) => ({
      batchId: round.metadata?.batchId ?? null,
      chosenBoardId: round.chosenBoardId,
      id: round.id,
      pageId: round.pageId,
      recommendedBoardId: round.recommendedBoardId,
      status: round.status,
      title: round.title,
    })),
  };
};

export const withoutDraftPicks = (artboard: ArtboardItem): ArtboardItem => ({
  ...artboard,
  content: {
    ...artboard.content,
    rounds: artboard.content.rounds.map((round) =>
      round.status === 'open' ? { ...round, chosenBoardId: null } : round,
    ),
  },
});
