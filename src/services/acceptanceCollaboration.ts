import { lambdaClient } from '@/libs/trpc/client';

/** Edit-collaboration on an acceptance: its bound conversation, read and written as its owner. */
class AcceptanceCollaborationService {
  getConversation = (acceptanceId: string) =>
    lambdaClient.acceptance.getOriginConversation.query({ id: acceptanceId });

  send = (acceptanceId: string, content: string) =>
    lambdaClient.acceptance.sendToOriginAgent.mutate({ content, id: acceptanceId });
}

export const acceptanceCollaborationService = new AcceptanceCollaborationService();
