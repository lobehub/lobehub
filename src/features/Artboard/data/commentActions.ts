import type { ArtboardCommentAnchor, ArtboardRect } from '@lobechat/types';

import { artboardService } from '@/services/artboard';

import type { BoardModel } from '../model';
import { mutateArtboard } from './useArtboard';
import { mutateArtboardComments } from './useArtboardComments';

export interface CommentTarget {
  anchor: ArtboardCommentAnchor;
  boardId?: string;
  groupId?: string;
  pageId: string | undefined;
}

const contains = (rect: ArtboardRect, { x, y }: { x: number; y: number }) =>
  x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

export const commentTargetAt = (
  model: BoardModel,
  point: { x: number; y: number },
): CommentTarget => {
  const { pageId } = model;
  const board = model.boards.findLast((item) => contains(item.rect, point));
  if (board)
    return {
      anchor: {
        type: 'canvas',
        x: (point.x - board.rect.x) / board.rect.w,
        y: (point.y - board.rect.y) / board.rect.h,
      },
      boardId: board.id,
      pageId,
    };

  const group = model.groups.findLast((item) => contains(item.rect, point));
  if (group)
    return {
      anchor: { type: 'canvas', x: point.x - group.rect.x, y: point.y - group.rect.y },
      groupId: group.id,
      pageId,
    };

  return { anchor: { type: 'canvas', x: point.x, y: point.y }, pageId };
};

export const addThread = async (artboardId: string, target: CommentTarget, content: string) => {
  const thread = await artboardService.addComment(artboardId, {
    ...target,
    clientId: crypto.randomUUID(),
    content,
  });
  await mutateArtboardComments(artboardId);
  return thread;
};

export const replyThread = async (artboardId: string, threadId: string, content: string) => {
  await artboardService.replyComment(threadId, crypto.randomUUID(), content);
  await mutateArtboardComments(artboardId);
};

export const settleThread = async (artboardId: string, threadId: string, resolved: boolean) => {
  await (resolved
    ? artboardService.resolveComment(threadId)
    : artboardService.reopenComment(threadId));
  await Promise.all([mutateArtboardComments(artboardId), mutateArtboard(artboardId)]);
};
