import type {
  AcceptanceAccessDecision,
  AcceptanceCommentList,
  CreateAcceptanceCommentInput,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AcceptanceCommentService {
  answerAccessRequest = (id: string, decision: AcceptanceAccessDecision) =>
    lambdaClient.acceptanceComment.answerAccessRequest.mutate({ decision, id });

  create = (input: CreateAcceptanceCommentInput) =>
    lambdaClient.acceptanceComment.create.mutate(input);

  delete = (id: string) => lambdaClient.acceptanceComment.delete.mutate({ id });

  list = (acceptanceId: string): Promise<AcceptanceCommentList> =>
    lambdaClient.acceptanceComment.list.query({ acceptanceId });

  requestAccess = (input: {
    acceptanceId: string;
    clientId: string;
    content?: string;
    contextRunId?: string;
  }) => lambdaClient.acceptanceComment.requestAccess.mutate(input);

  react = (id: string, emoji: string, on: boolean) =>
    lambdaClient.acceptanceComment.react.mutate({ emoji, id, on });

  setResolved = (id: string, resolved: boolean) =>
    lambdaClient.acceptanceComment.setResolved.mutate({ id, resolved });
}

export const acceptanceCommentService = new AcceptanceCommentService();
