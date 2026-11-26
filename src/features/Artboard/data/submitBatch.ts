import type { ArtboardCommentThreadView, ArtboardRoundView } from '@lobechat/types';
import { t } from 'i18next';

import { serializeArtboardReference } from '@/features/ChatInput/InputEditor/ReferArtboard';
import { artboardService } from '@/services/artboard';

import type { BoardModel } from '../model';
import { sendToBoardConversation } from './boardConversation';
import { isQuestion } from './commentModel';
import { mutateArtboard } from './useArtboard';
import { mutateArtboardComments } from './useArtboardComments';

const translate = (key: string, options?: Record<string, unknown>) =>
  t(key as 'artboard.chat.quote', { ...options, ns: 'project' }) as string;

export interface RoundSummary {
  byRecommendation: number;
  firstUndecidedId: string | undefined;
  picked: number;
  total: number;
  undecided: number;
}

export const summarizeRounds = (open: ArtboardRoundView[]): RoundSummary => {
  const picked = open.filter((round) => round.chosenBoardId).length;
  const undecided = open.filter((round) => !round.chosenBoardId && !round.recommendedBoardId);
  return {
    byRecommendation: open.length - picked - undecided.length,
    firstUndecidedId: undecided[0]?.id,
    picked,
    total: open.length,
    undecided: undecided.length,
  };
};

// The submit bar submits every open round, so comments held on their options go out with it.
export const pendingThreads = (threads: ArtboardCommentThreadView[]) =>
  threads.filter((thread) => thread.unread && (!thread.resolvedAt || isQuestion(thread)));

const placeTitle = (model: BoardModel, thread: ArtboardCommentThreadView) => {
  const board = thread.boardId ? model.boardById[thread.boardId] : undefined;
  if (board) return board.title;
  const group = thread.groupId ? model.groups.find((g) => g.id === thread.groupId) : undefined;
  return group?.title ?? translate('artboard.comment.onCanvas');
};

const newestFromUser = (thread: ArtboardCommentThreadView) => {
  const comments = [thread, ...thread.replies];
  const lastAgent = comments.findLastIndex((comment) => !!comment.authorAgentId);
  return comments.slice(lastAgent + 1).map((comment) => comment.content);
};

const quoteThread = (model: BoardModel, thread: ArtboardCommentThreadView) =>
  [
    serializeArtboardReference(
      {
        artboardId: model.artboard.id,
        itemId: thread.id,
        itemTitle: placeTitle(model, thread),
        text: '',
      },
      translate,
    ),
    newestFromUser(thread).join('\n\n'),
  ].join('\n\n');

export type SubmitStatus = 'messageFailed' | 'noConversation' | 'nothing' | 'sent';

export const submitBoardBatch = async (
  model: BoardModel,
  roundIds: string[],
): Promise<{ message: string; status: SubmitStatus }> => {
  const { artboard } = model;
  const choices = roundIds.length
    ? (await artboardService.submitRounds(artboard.id, roundIds)).submitted
    : 0;
  const threads = (await artboardService.deliverComments(artboard.id)).filter(
    (thread) => thread.unread,
  );
  void mutateArtboard(artboard.id);
  void mutateArtboardComments(artboard.id);

  const message = [
    ...(choices ? [translate('artboard.submit.message', { count: choices })] : []),
    ...(threads.length
      ? [translate('artboard.submit.commentMessage', { count: threads.length })]
      : []),
    ...threads.map((thread) => quoteThread(model, thread)),
    `> artboard ${artboard.id} · ${artboard.title}`,
  ].join('\n\n');
  if (!choices && !threads.length) return { message, status: 'nothing' };

  try {
    return { message, status: await sendToBoardConversation(artboard.topicId, message) };
  } catch (error) {
    console.error('[artboard:submit]', error);
    return { message, status: 'messageFailed' };
  }
};
