import { lambdaClient } from '@/libs/trpc/client';

class ArtifactBoardService {
  choose = (boardId: string, roundId: string, optionId: string) =>
    lambdaClient.artifactBoard.choose.mutate({ boardId, optionId, roundId });

  get = (boardId: string, version?: number) =>
    lambdaClient.artifactBoard.get.query({ boardId, version });

  /** Put the board's picks on an acceptance's frames board as baseline candidates. */
  publishToAcceptance = (boardId: string, acceptanceId: string) =>
    lambdaClient.acceptance.publishBoardCandidates.mutate({ boardId, id: acceptanceId });
}

export const artifactBoardService = new ArtifactBoardService();
