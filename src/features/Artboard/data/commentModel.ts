import type { ArtboardCommentThreadView } from '@lobechat/types';

import type { BoardModel } from '../model';

export interface ThreadPin {
  thread: ArtboardCommentThreadView;
  x: number;
  y: number;
}

export type ThreadPlace =
  { kind: 'board'; title: string } | { kind: 'group'; title: string } | { kind: 'canvas' };

const GROUP_PIN_INSET = 16;

export const isQuestion = (thread: ArtboardCommentThreadView) => !!thread.authorAgentId;

export const isAnswered = (thread: ArtboardCommentThreadView) =>
  thread.replies.some((reply) => !reply.authorAgentId);

const positionOf = (thread: ArtboardCommentThreadView, model: BoardModel) => {
  const point = thread.anchor?.type === 'canvas' ? thread.anchor : undefined;
  const board = thread.boardId ? model.boardById[thread.boardId] : undefined;
  if (board) {
    const { rect } = board;
    return point
      ? { x: rect.x + point.x * rect.w, y: rect.y + point.y * rect.h }
      : { x: rect.x + rect.w, y: rect.y };
  }
  const group = thread.groupId ? model.groups.find((g) => g.id === thread.groupId) : undefined;
  if (group)
    return {
      x: group.rect.x + (point?.x ?? GROUP_PIN_INSET),
      y: group.rect.y + (point?.y ?? GROUP_PIN_INSET),
    };
  return point ? { x: point.x, y: point.y } : { x: model.bounds.minX, y: model.bounds.minY };
};

export const pagePins = (threads: ArtboardCommentThreadView[], model: BoardModel): ThreadPin[] =>
  threads
    .filter((thread) => thread.pageId === model.pageId)
    .map((thread) => ({ thread, ...positionOf(thread, model) }));

export const waitingQuestions = (threads: ArtboardCommentThreadView[]) =>
  threads.filter((thread) => isQuestion(thread) && !thread.resolvedAt && !isAnswered(thread));

export const nextQuestion = (threads: ArtboardCommentThreadView[], afterId: string | null) => {
  const waiting = waitingQuestions(threads);
  const index = waiting.findIndex((thread) => thread.id === afterId);
  return waiting[(index + 1) % waiting.length];
};

export const threadPlace = (thread: ArtboardCommentThreadView, model: BoardModel): ThreadPlace => {
  const board = thread.boardId ? model.boardById[thread.boardId] : undefined;
  if (board) return { kind: 'board', title: board.title };
  const group = thread.groupId ? model.groups.find((g) => g.id === thread.groupId) : undefined;
  return group ? { kind: 'group', title: group.title } : { kind: 'canvas' };
};
