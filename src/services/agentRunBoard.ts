import type { AgentRunBoardScope, AgentRunBoardWindowHours } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface AgentRunBoardQuery {
  agentId?: string;
  scope: AgentRunBoardScope;
  userId?: string;
  windowHours: AgentRunBoardWindowHours;
}

class AgentRunBoardService {
  get = async (query: AgentRunBoardQuery) => {
    const { data } = await lambdaClient.agentRunBoard.get.query(query);
    return data;
  };
}

export const agentRunBoardService = new AgentRunBoardService();
