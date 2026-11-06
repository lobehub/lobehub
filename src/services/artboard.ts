import type { ArtboardUserOp } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

type ArtboardRouter = typeof lambdaClient.artboard;

export type ArtboardView = Awaited<ReturnType<ArtboardRouter['get']['query']>>;
export type ArtboardWrite = Awaited<ReturnType<ArtboardRouter['applyUserOps']['mutate']>>;
export type ArtboardFinalize = Awaited<ReturnType<ArtboardRouter['finalize']['mutate']>>;

class ArtboardService {
  applyUserOps = (id: string, revision: number, ops: ArtboardUserOp[]) =>
    lambdaClient.artboard.applyUserOps.mutate({ id, ops, revision });

  finalize = (id: string, revision: number) =>
    lambdaClient.artboard.finalize.mutate({ id, revision });

  get = (id: string) => lambdaClient.artboard.get.query({ id });

  getConversation = (topicId: string) => lambdaClient.topic.getTopicDetail.query({ id: topicId });

  getRevision = (id: string) => lambdaClient.artboard.getRevision.query({ id });

  listByProject = (projectId: string) => lambdaClient.artboard.listByProject.query({ projectId });
}

export const artboardService = new ArtboardService();
