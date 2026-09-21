import { lambdaClient } from '@/libs/trpc/client';

class DocumentLikeService {
  like = (documentId: string) => lambdaClient.documentLike.like.mutate({ documentId });

  summary = (documentId: string) => lambdaClient.documentLike.summary.query({ documentId });

  unlike = (documentId: string) => lambdaClient.documentLike.unlike.mutate({ documentId });
}

export const documentLikeService = new DocumentLikeService();
