import type { AcceptanceCommentList, CreateAcceptanceCommentInput } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AcceptanceCommentService {
  create = (input: CreateAcceptanceCommentInput) =>
    lambdaClient.acceptanceComment.create.mutate(input);

  delete = (id: string) => lambdaClient.acceptanceComment.delete.mutate({ id });

  list = (acceptanceId: string): Promise<AcceptanceCommentList> =>
    lambdaClient.acceptanceComment.list.query({ acceptanceId });

  react = (id: string, emoji: string, on: boolean) =>
    lambdaClient.acceptanceComment.react.mutate({ emoji, id, on });

  setResolved = (id: string, resolved: boolean) =>
    lambdaClient.acceptanceComment.setResolved.mutate({ id, resolved });
}

export const acceptanceCommentService = new AcceptanceCommentService();
