import type { AgentRunBoardScope, AgentRunBoardWindowHours } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AgentRunBoardService {
  get = async (windowHours: AgentRunBoardWindowHours, scope: AgentRunBoardScope) => {
    const { data } = await lambdaClient.agentRunBoard.get.query({ scope, windowHours });
    return data;
  };
}

export const agentRunBoardService = new AgentRunBoardService();
