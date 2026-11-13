import type {
  ArtboardCommentAnchor,
  ArtboardCommentThreadView,
  ArtboardItem,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface ArtboardView {
  artboard: ArtboardItem;
  imageUrls: Record<string, string>;
}

export interface ArtboardFinalize {
  acceptanceId: string;
  artboard: ArtboardItem;
}

export interface ArtboardCommentInput {
  anchor?: ArtboardCommentAnchor;
  boardId?: string;
  clientId: string;
  content: string;
  groupId?: string;
  pageId?: string;
}

class ArtboardService {
  addComment = (id: string, input: ArtboardCommentInput) =>
    lambdaClient.artboard.addComment.mutate({ id, ...input });

  chooseBoard = (
    id: string,
    roundId: string,
    boardId: string,
  ): Promise<{ artboard: ArtboardItem }> =>
    lambdaClient.artboard.chooseBoard.mutate({ boardId, id, roundId });

  countUndeliveredComments = (id: string): Promise<number> =>
    lambdaClient.artboard.countUndeliveredComments.query({ id });

  finalize = (id: string, revision: number): Promise<ArtboardFinalize> =>
    lambdaClient.artboard.finalize.mutate({ id, revision });

  get = (id: string): Promise<ArtboardView> => lambdaClient.artboard.get.query({ id });

  getConversation = (topicId: string) => lambdaClient.topic.getTopicDetail.query({ id: topicId });

  getRevision = (id: string) => lambdaClient.artboard.getRevision.query({ id });

  listByProject = (projectId: string) => lambdaClient.artboard.listByProject.query({ projectId });

  listComments = (id: string): Promise<ArtboardCommentThreadView[]> =>
    lambdaClient.artboard.listComments.query({ id });

  reopenComment = (commentId: string) => lambdaClient.artboard.reopenComment.mutate({ commentId });

  replyComment = (commentId: string, clientId: string, content: string) =>
    lambdaClient.artboard.replyComment.mutate({ clientId, commentId, content });

  resolveComment = (commentId: string) =>
    lambdaClient.artboard.resolveComment.mutate({ commentId });

  submitRound = (id: string, roundId: string): Promise<{ artboard: ArtboardItem }> =>
    lambdaClient.artboard.submitRound.mutate({ id, roundId });

  submitRounds = (id: string): Promise<{ artboard: ArtboardItem; submitted: number }> =>
    lambdaClient.artboard.submitRounds.mutate({ id });
}

export const artboardService = new ArtboardService();
