import type { AcceptanceFrameBoardView, AcceptanceFrameOperation } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AcceptanceFrameService {
  getBoard = (acceptanceId: string): Promise<AcceptanceFrameBoardView | null> =>
    lambdaClient.acceptance.getFrameBoard.query({ id: acceptanceId });

  updateFrame = (
    acceptanceId: string,
    frameId: string,
    operation: AcceptanceFrameOperation,
    expectedVersion?: number,
  ) =>
    lambdaClient.acceptance.updateFrame.mutate({
      expectedVersion,
      frameId,
      id: acceptanceId,
      operation,
    });
}

export const acceptanceFrameService = new AcceptanceFrameService();
