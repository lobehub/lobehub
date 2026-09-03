import type { CreateDocumentCommentInput, UpdateDocumentCommentInput } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class DocumentCommentService {
  create = (input: CreateDocumentCommentInput) => lambdaClient.documentComment.create.mutate(input);

  delete = (id: string) => lambdaClient.documentComment.delete.mutate({ id });

  get = (id: string) => lambdaClient.documentComment.get.query({ id });

  listReplies = (params: { cursor?: string; limit?: number; rootCommentId: string }) =>
    lambdaClient.documentComment.listReplies.query(params);

  listThreads = (params: { cursor?: string; documentId: string; limit?: number }) =>
    lambdaClient.documentComment.listThreads.query(params);

  summary = (documentId: string) => lambdaClient.documentComment.summary.query({ documentId });

  update = (input: UpdateDocumentCommentInput) => lambdaClient.documentComment.update.mutate(input);
}

export const documentCommentService = new DocumentCommentService();
