import type { AgentRunBoardWindowHours } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AgentRunBoardService {
  get = async (windowHours: AgentRunBoardWindowHours) => {
    const { data } = await lambdaClient.agentRunBoard.get.query({ windowHours });
    return data;
  };
}

export const agentRunBoardService = new AgentRunBoardService();
