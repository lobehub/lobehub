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

// A user may close an agent's question right after answering it; the answer still reaches the agent.
export const isThreadUnread = ({ replies, root }: ArtboardCommentThread) =>
  (!root.resolvedAt || !!root.authorAgentId) &&
  [root, ...replies].some((comment) => !comment.authorAgentId && !comment.deliveredAt);

const anchorOf = ({ anchor, boardId, groupId, metadata }: ArtboardCommentThread['root']) => {
  const space = metadata?.anchorSpace;
  const orphaned = (space === 'board' && !boardId) || (space === 'group' && !groupId);
  return orphaned ? null : (anchor ?? null);
};

export const toCommentThreadView = (
  thread: ArtboardCommentThread,
  stale: boolean,
): ArtboardCommentThreadView => ({
  ...toCommentView(thread.root),
  anchor: anchorOf(thread.root),
  boardId: thread.root.boardId,
  groupId: thread.root.groupId,
  pageId: thread.root.pageId,
  replies: thread.replies.map(toCommentView),
  resolvedAt: thread.root.resolvedAt,
  stale,
  unread: isThreadUnread(thread),
});

export const toArtboardContent = (
  structure: ArtboardStructure,
  openThreads: ArtboardCommentThread[],
  hashes: ReadonlyMap<string, string>,
): ArtboardContent => {
  const groupRects = new Map(structure.groups.map((group) => [group.id, group.rect]));

  // A board may point at a file not written yet, or one deleted since: hash null, nothing to show.
  const sourceOf = (board: ArtboardStructure['boards'][number]): ArtboardBoardSource | null =>
    board.sourcePath
      ? { hash: hashes.get(board.sourcePath) ?? null, kind: 'file', path: board.sourcePath }
      : null;

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
      .map(({ replies, root }) => ({
        answered: replies.some((reply) => !reply.authorAgentId),
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
